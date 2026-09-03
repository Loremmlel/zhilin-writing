import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openDocxPackage } from "../lib/docx-import/package.ts";
import { parseDocx } from "../lib/docx-import/parse.ts";

type PublicFixture = {
  id: string;
  filename?: string;
  producer: string;
  observedVersion?: string;
  status: "available" | "unavailable";
  sha256?: string;
  skipReason?: string;
  sourceStatement?: string;
  evidenceNote?: string;
  observedProducerEvidence?: { part: string; contains: string } | null;
};

type PublicFixtureManifest = {
  schemaVersion: 1;
  fixtures: PublicFixture[];
};

const directory = resolve("tests/fixtures/docx/public");
const manifestPath = resolve(directory, "manifest.json");

test("the public DOCX acquisition command verifies every pinned local byte", async () => {
  const manifest = await loadManifest();
  const available = manifest.fixtures.filter((fixture) => fixture.status === "available");
  const unavailable = manifest.fixtures.filter((fixture) => fixture.status === "unavailable");
  assert.equal(available.length, 4);
  assert.deepEqual(
    unavailable.map((fixture) => fixture.id),
    ["word-online"],
  );
  assert.match(unavailable[0]?.skipReason ?? "", /provenance/i);

  const result = spawnSync(
    process.execPath,
    ["scripts/fixtures/fetch-public-docx-fixtures.mjs", "--verify"],
    { cwd: resolve("."), encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /verified 4 public DOCX fixtures/);
  assert.match(result.stdout, /skipped word-online:/);
});

test("available public producers parse twice with stable order and typed output", async () => {
  const manifest = await loadManifest();
  for (const fixture of manifest.fixtures.filter((item) => item.status === "available")) {
    assert.ok(fixture.filename, fixture.id);
    assert.match(fixture.sha256 ?? "", /^[0-9a-f]{64}$/);
    const bytes = await readFile(resolve(directory, fixture.filename!));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256, fixture.id);
    assert.ok(fixture.sourceStatement, fixture.id);
    const pkg = await openDocxPackage(new File([Uint8Array.from(bytes)], fixture.filename!));
    try {
      if (fixture.observedProducerEvidence) {
        assert.equal(pkg.has(fixture.observedProducerEvidence.part), true, fixture.id);
        const evidence = await pkg.readText(fixture.observedProducerEvidence.part);
        assert.match(
          evidence,
          new RegExp(escapeRegex(fixture.observedProducerEvidence.contains)),
          fixture.id,
        );
        if (fixture.id.startsWith("word-desktop"))
          assert.match(evidence, /<AppVersion>14\.0000<\/AppVersion>/);
        if (fixture.id === "libreoffice") assert.match(evidence, /LibreOffice\/5\.4\.5\.1/);
      } else {
        assert.match(fixture.evidenceNote ?? "", /metadata|evidence/i, fixture.id);
      }
    } finally {
      await pkg.close();
    }

    const first = await parsePublicFixture(bytes, fixture);
    const second = await parsePublicFixture(bytes, fixture);
    assert.equal(first.canonicalMarkdown, second.canonicalMarkdown, fixture.id);
    assert.equal(JSON.stringify(first.warnings), JSON.stringify(second.warnings), fixture.id);
    assert.deepEqual(
      first.blocks.map((block) => block.id),
      second.blocks.map((block) => block.id),
      fixture.id,
    );
    assert.equal(
      new Set(first.blocks.map((block) => block.id)).size,
      first.blocks.length,
      fixture.id,
    );
    assert.ok(first.blocks.length > 0, fixture.id);
    assert.ok(
      first.warnings.every(
        (warning) => typeof warning.code === "string" && typeof warning.severity === "string",
      ),
      fixture.id,
    );
    assertProducerFeatures(fixture.id, first);
  }
});

test("Word Online remains an explicit compatibility skip without relabeling another producer", async (context) => {
  const fixture = (await loadManifest()).fixtures.find((item) => item.id === "word-online");
  assert.ok(fixture);
  if (fixture.status === "unavailable") {
    context.skip(fixture.skipReason);
    return;
  }
  assert.equal(fixture.producer, "Microsoft Word Online");
});

async function loadManifest(): Promise<PublicFixtureManifest> {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as PublicFixtureManifest;
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(new Set(parsed.fixtures.map((fixture) => fixture.id)).size, parsed.fixtures.length);
  return parsed;
}

async function parsePublicFixture(bytes: Uint8Array, fixture: PublicFixture) {
  return parseDocx(new File([Uint8Array.from(bytes)], fixture.filename!), undefined, {
    createAnnotationId: (sourceId) => `ann_public-${fixture.id}-${sourceId}`,
    createReplyId: (sourceId) => `reply_public-${fixture.id}-${sourceId}`,
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertProducerFeatures(id: string, parsed: Awaited<ReturnType<typeof parseDocx>>) {
  const warningCodes = parsed.warnings.map((warning) => warning.code);
  if (id === "word-desktop-comments") {
    assert.equal(parsed.threads.length, 1);
    assert.equal(parsed.threads[0]?.sourceCommentId, "0");
    assert.deepEqual(
      parsed.skippedThreads.map((thread) => thread.warning.code),
      ["ANNOTATION_ORPHAN_DEFINITION"],
    );
    return;
  }
  if (id === "word-desktop-footnotes") {
    assert.deepEqual(
      parsed.blocks.map((block) => block.type),
      ["paragraph", "notesAppendix"],
    );
    assert.ok(warningCodes.includes("NOTES_FLATTENED_TO_APPENDIX"));
    return;
  }
  if (id === "google-docs-export") {
    assert.equal(parsed.suggestedTitle, "Heading A");
    assert.ok(parsed.blocks.filter((block) => block.type === "heading").length >= 5);
    return;
  }
  if (id === "libreoffice") {
    assert.equal(parsed.assets.length, 1);
    assert.equal(parsed.assets[0]?.floating, true);
    assert.ok(warningCodes.includes("FLOATING_IMAGE_FLATTENED"));
    return;
  }
  assert.fail(`Unhandled public producer fixture ${id}`);
}
