import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import "fake-indexeddb/auto";

import {
  listImportPreviews,
  loadImportPreview,
  purgeExpiredImportPreviews,
  removeImportPreview,
  saveImportPreview,
} from "../lib/docx-import/preview-store.ts";
import { DOCX_IMPORT_LIMITS } from "../lib/docx-import/limits.ts";
import type { DocxPreviewRecord } from "../lib/docx-import/types.ts";
import { LOCAL_DB_NAME } from "../lib/indexed-db.ts";

beforeEach(deleteLocalDatabase);
afterEach(deleteLocalDatabase);

test("recovers a complete finalized Preview without original DOCX bytes", async () => {
  const preview = previewFixture("batch-1", "2026-08-30T00:00:00.000Z");
  await saveImportPreview(preview, Date.parse("2026-08-29T12:00:00.000Z"));

  const loaded = await loadImportPreview("batch-1", Date.parse("2026-08-29T12:00:00.000Z"));
  assert.deepEqual(loaded, preview);
  assert.equal(loaded?.ir.source.filename, "source.docx");
  assert.equal(loaded?.ir.source.sha256, "source-hash");
  assert.equal(loaded?.title, "Imported title");
  assert.equal(loaded?.temporaryAssets[0]?.assetId, "asset-1");
  assert.equal(loaded?.authorMappings.Author, "user-1");
  assert.equal(loaded?.ir.threads[0]?.annotationId, "ann_00000000-0000-4000-8000-000000000001");
  assert.equal(containsOriginalBinary(loaded), false);
});

test("derives a 24-hour expiry when a Preview has invalid timestamps", async () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  await saveImportPreview(previewFixture("derived", "not-a-date", "not-a-date"), now);

  const loaded = await loadImportPreview(
    "derived",
    now + DOCX_IMPORT_LIMITS.previewTtlMs - 1,
  );
  assert.equal(loaded?.createdAt, new Date(now).toISOString());
  assert.equal(loaded?.expiresAt, new Date(now + DOCX_IMPORT_LIMITS.previewTtlMs).toISOString());
});

test("treats rollover and numeric timestamps as invalid instead of extending their parsed date", async () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  for (const value of ["0", "2026-02-30T00:00:00.000Z"]) {
    await saveImportPreview(previewFixture(`invalid-${value}`, value, value), now);
    const loaded = await loadImportPreview(
      `invalid-${value}`,
      now + DOCX_IMPORT_LIMITS.previewTtlMs - 1,
    );
    assert.equal(loaded?.createdAt, new Date(now).toISOString());
  }
});

test("strips accidental source binary fields before IndexedDB persistence", async () => {
  const preview = {
    ...previewFixture("contaminated", "2026-08-30T00:00:00.000Z"),
    sourceFile: new File(["original docx"], "source.docx"),
  } as DocxPreviewRecord & { sourceFile: File };
  await saveImportPreview(preview, Date.parse("2026-08-29T12:00:00.000Z"));

  const loaded = await loadImportPreview("contaminated", Date.parse("2026-08-29T12:00:00.000Z"));
  assert.equal(containsOriginalBinary(loaded), false);
  assert.equal("sourceFile" in (loaded ?? {}), false);
});

test("rejects non-Uint8Array asset bytes while retaining valid extracted image bytes", async () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  const validAsset = {
    id: "asset-1",
    filename: "image.png",
    mimeType: "image/png" as const,
    bytes: new Uint8Array([1, 2, 3]),
    alt: "image",
    sourceRelationshipId: "rImage",
    floating: false,
  };
  const valid = previewFixture("valid-asset", "2026-08-30T00:00:00.000Z");
  valid.ir.assets = [validAsset];
  await saveImportPreview(valid, now);
  const loaded = await loadImportPreview("valid-asset", now);
  assert.deepEqual([...((loaded?.ir.assets[0]?.bytes ?? new Uint8Array()) as Uint8Array)], [1, 2, 3]);

  for (const [label, bytes] of [
    ["array-buffer", new ArrayBuffer(3)],
    ["blob", new Blob(["abc"])],
    ["data-view", new DataView(new ArrayBuffer(3))],
  ] as const) {
    const contaminated = previewFixture(`invalid-asset-${label}`, "2026-08-30T00:00:00.000Z");
    contaminated.ir.assets = [{ ...validAsset, bytes } as never];
    await assert.rejects(
      saveImportPreview(contaminated, now),
      (error: unknown) => error instanceof Error && error.name === "DocxImportError",
    );
  }
});

test("purges Previews expiring at or before the 24-hour boundary", async () => {
  await saveImportPreview(
    previewFixture("expired", "2026-08-29T12:00:00.000Z", "2026-08-28T12:00:00.000Z"),
    Date.parse("2026-08-29T12:00:00.000Z"),
  );
  await saveImportPreview(
    previewFixture("active", "2026-08-29T12:00:00.001Z", "2026-08-28T12:00:00.001Z"),
    Date.parse("2026-08-29T12:00:00.000Z"),
  );

  assert.equal(await purgeExpiredImportPreviews(Date.parse("2026-08-29T12:00:00.000Z")), 1);
  assert.equal(await loadImportPreview("expired", Date.parse("2026-08-29T12:00:00.000Z")), null);
  assert.equal((await loadImportPreview("active", Date.parse("2026-08-29T12:00:00.000Z")))?.importBatchId, "active");
});

test("removes a Preview after commit or explicit abandonment", async () => {
  await saveImportPreview(
    previewFixture("batch-1", "2026-08-30T00:00:00.000Z"),
    Date.parse("2026-08-29T12:00:00.000Z"),
  );
  await removeImportPreview("batch-1");
  assert.equal(await loadImportPreview("batch-1", Date.parse("2026-08-29T12:00:00.000Z")), null);
});

test("removes a Preview when cancellation arrives during persistence", async () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  const controller = new AbortController();
  const saving = saveImportPreview(previewFixture("cancelled", "2026-08-30T00:00:00.000Z"), now, controller.signal);
  queueMicrotask(() => controller.abort());

  await assert.rejects(saving, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(await loadImportPreview("cancelled", now), null);
});

test("lists active recoverable Previews newest first without expired records", async () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  await saveImportPreview(previewFixture("older", "ignored", "2026-08-29T10:00:00.000Z"), now);
  await saveImportPreview(previewFixture("newer", "ignored", "2026-08-29T11:00:00.000Z"), now);
  await saveImportPreview(previewFixture("expired", "ignored", "2026-08-28T10:00:00.000Z"), now);

  const previews = await listImportPreviews(now);
  assert.deepEqual(previews.map((preview) => preview.importBatchId), ["newer", "older"]);
});

function previewFixture(importBatchId: string, expiresAt: string, createdAt = "2026-08-29T00:00:00.000Z"): DocxPreviewRecord {
  return {
    version: 1,
    importBatchId,
    title: "Imported title",
    createdAt,
    expiresAt,
    ir: {
      version: 1,
      importBatchId,
      source: { filename: "source.docx", producer: "Word", sha256: "source-hash" },
      suggestedTitle: "Imported",
      blocks: [{
        id: "p1",
        type: "paragraph",
        segments: [{ text: "正文", marks: [], commentIds: ["10"] }],
      }],
      assets: [],
      threads: [{
        annotationId: "ann_00000000-0000-4000-8000-000000000001",
        sourceCommentId: "10",
        blockId: "p1",
        blockLocalStart: 0,
        blockLocalEnd: 2,
        sourceAuthorName: "Author",
        sourceDocumentOrder: 0,
        sourceResolved: false,
        bodyMarkdown: "Root",
        replies: [{
          replyId: "00000000-0000-4000-8000-000000000002",
          sourceCommentId: "11",
          parentSourceCommentId: "10",
          sourceAuthorName: "Reply Author",
          sourceDocumentOrder: 1,
          sourceResolved: false,
          bodyMarkdown: "Reply",
        }],
      }],
      skippedThreads: [],
      warnings: [{ code: "TABLE_HEADER_SYNTHESIZED", severity: "warning", count: 1 }],
      canonicalMarkdown: ":annotation[正文]{#ann_00000000-0000-4000-8000-000000000001}",
    },
    canonicalMarkdown: ":annotation[正文]{#ann_00000000-0000-4000-8000-000000000001}",
    temporaryAssets: [{
      assetId: "asset-1",
      temporaryUrl: "/api/assets/asset-1",
      filename: "image.png",
      mimeType: "image/png",
    }],
    authorMappings: { Author: "user-1" },
  };
}

function containsOriginalBinary(value: unknown, seen = new Set<object>()): boolean {
  if (value instanceof File || value instanceof Blob || value instanceof ArrayBuffer) return true;
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => containsOriginalBinary(item, seen));
}

function deleteLocalDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to delete test database"));
    request.onblocked = () => reject(new Error("test database deletion was blocked"));
  });
}
