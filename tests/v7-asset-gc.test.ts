import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { assertUntrackedR2Execution, runAssetGcCandidates, untrackedR2Candidates, type AssetGcCandidate, type AssetGcFailureCode } from "../lib/assets/gc-core.ts";

const now = new Date("2026-09-03T12:00:00.000Z");
const candidates: AssetGcCandidate[] = [
  { id: "expired", r2Key: "expired", byteSize: 10, status: "temporary", createdAt: new Date(now.getTime() - 8 * 86_400_000), expiresAt: new Date(now.getTime() - 1) },
  { id: "orphan", r2Key: "orphan", byteSize: 20, status: "permanent", createdAt: new Date(now.getTime() - 1), expiresAt: null },
  { id: "referenced", r2Key: "referenced", byteSize: 40, status: "permanent", createdAt: new Date(now.getTime() - 1), expiresAt: null },
  { id: "recent", r2Key: "recent", byteSize: 80, status: "temporary", createdAt: new Date(now.getTime() - 86_400_000), expiresAt: new Date(now.getTime() - 1) },
];

function dependencies(events: string[], finalReferenced = false) {
  let expiredChecks = 0;
  return {
    async referenceCounts(assetId: string) {
      if (assetId === "expired") expiredChecks += 1;
      const referenced = assetId === "referenced" || (assetId === "expired" && finalReferenced && expiredChecks > 1);
      return { currentRefCount: referenced ? 1 : 0, revisionRefCount: 0, avatarRefCount: 0 };
    },
    async claim(assetId: string) { events.push(`claim:${assetId}`); return true; },
    async releaseClaim(assetId: string) { events.push(`release:${assetId}`); },
    async deleteObject(candidate: AssetGcCandidate) {
      events.push(`delete:${candidate.id}`);
      if (candidate.id === "expired") throw new Error("injected R2 failure");
    },
    async markDeleted(assetId: string) { events.push(`mark:${assetId}`); },
    async recordFailure(assetId: string, code: AssetGcFailureCode) { events.push(`failure:${assetId}:${code}`); },
  };
}

test("GC dry-run reports candidate count, bytes, ids and reasons without mutation", async () => {
  const events: string[] = [];
  const report = await runAssetGcCandidates({ candidates, now, dryRun: true, dependencies: dependencies(events) });
  assert.deepEqual(report.candidates, [
    { assetId: "expired", bytes: 10, reason: "EXPIRED_TEMPORARY" },
    { assetId: "orphan", bytes: 20, reason: "PERMANENT_ORPHAN" },
  ]);
  assert.equal(report.candidateCount, 2);
  assert.equal(report.bytes, 30);
  assert.deepEqual(events, []);
});

test("one R2 delete failure is recorded without deleting metadata or blocking later candidates", async () => {
  const events: string[] = [];
  const report = await runAssetGcCandidates({ candidates, now, dryRun: false, dependencies: dependencies(events) });
  assert.deepEqual(report.failures, [{ assetId: "expired", code: "R2_DELETE_FAILED" }]);
  assert.deepEqual(report.collected, ["orphan"]);
  assert.equal(events.includes("mark:expired"), false);
  assert.equal(events.includes("failure:expired:R2_DELETE_FAILED"), true);
  assert.equal(events.includes("delete:orphan"), true);
  assert.equal(events.includes("mark:orphan"), true);
});

test("a new reference after claim wins the final GC recheck", async () => {
  const events: string[] = [];
  const report = await runAssetGcCandidates({ candidates: [candidates[0]!], now, dryRun: false, dependencies: dependencies(events, true) });
  assert.deepEqual(report.collected, []);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(events, ["claim:expired", "release:expired"]);
});

test("V7 GC migration is additive and binding paths reject claimed assets", async () => {
  const db = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const migration = files.find((name) => name.startsWith("0009_"));
  assert.ok(migration);
  for (const filename of files.filter((name) => name <= migration)) {
    const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  }
  const columns = db.prepare("PRAGMA table_info(assets)").all().map((row) => ({ ...row })) as Array<{ name: string; dflt_value: string | null }>;
  assert.equal(columns.find((column) => column.name === "gc_failure_count")?.dflt_value, "0");
  assert.ok(columns.some((column) => column.name === "gc_claimed_at"));
  db.close();

  const [posts, saveTransaction, docx, profile] = await Promise.all([
    readFile(new URL("../lib/posts/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/posts/save-transaction.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/docx-import/commit-plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/queries.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [posts, saveTransaction, docx, profile]) assert.match(source, /gcClaimedAt|gc_claimed_at/);
});

test("R2 inventory only reports old site-shaped objects absent from D1 and requires exact dry-run confirmation", () => {
  const old = new Date(now.getTime() - 8 * 86_400_000);
  const recent = new Date(now.getTime() - 86_400_000);
  const owner = "00112233-4455-4677-8899-aabbccddeeff";
  const orphanId = "11112233-4455-4677-8899-aabbccddeeff";
  const trackedId = "21112233-4455-4677-8899-aabbccddeeff";
  const orphanKey = `${owner}/image/${orphanId}-orphan.png`;
  const trackedKey = `${owner}/attachment/${trackedId}-tracked.pdf`;
  const found = untrackedR2Candidates([
    { key: orphanKey, size: 12, uploaded: old },
    { key: trackedKey, size: 13, uploaded: old },
    { key: `${owner}/image/31112233-4455-4677-8899-aabbccddeeff-recent.png`, size: 14, uploaded: recent },
    { key: `${owner}/unknown-object`, size: 15, uploaded: old },
  ], new Set([trackedKey]), now);
  assert.deepEqual(found, [{ assetId: orphanId, key: orphanKey, bytes: 12, reason: "UNTRACKED_R2_OBJECT" }]);
  assert.throws(() => assertUntrackedR2Execution(found, []), /exact dry-run asset IDs/);
  assert.doesNotThrow(() => assertUntrackedR2Execution(found, [orphanId]));
});
