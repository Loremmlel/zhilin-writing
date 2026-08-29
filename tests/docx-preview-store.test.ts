import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import "fake-indexeddb/auto";

import {
  loadImportPreview,
  purgeExpiredImportPreviews,
  removeImportPreview,
  saveImportPreview,
} from "../lib/docx-import/preview-store.ts";
import type { DocxPreviewRecord } from "../lib/docx-import/types.ts";
import { LOCAL_DB_NAME } from "../lib/indexed-db.ts";

beforeEach(deleteLocalDatabase);
afterEach(deleteLocalDatabase);

test("recovers a complete finalized Preview without original DOCX bytes", async () => {
  const preview = previewFixture("batch-1", "2026-08-30T00:00:00.000Z");
  await saveImportPreview(preview);

  const loaded = await loadImportPreview("batch-1", Date.parse("2026-08-29T12:00:00.000Z"));
  assert.deepEqual(loaded, preview);
  assert.equal(loaded?.ir.source.filename, "source.docx");
  assert.equal(loaded?.ir.source.sha256, "source-hash");
  assert.equal(loaded?.temporaryAssets[0]?.assetId, "asset-1");
  assert.equal(loaded?.authorMappings.Author, "user-1");
  assert.equal(loaded?.ir.threads[0]?.annotationId, "ann_00000000-0000-4000-8000-000000000001");
  assert.equal(containsOriginalBinary(loaded), false);
});

test("purges Previews expiring at or before the 24-hour boundary", async () => {
  await saveImportPreview(previewFixture("expired", "2026-08-29T12:00:00.000Z"));
  await saveImportPreview(previewFixture("active", "2026-08-29T12:00:00.001Z"));

  assert.equal(await purgeExpiredImportPreviews(Date.parse("2026-08-29T12:00:00.000Z")), 1);
  assert.equal(await loadImportPreview("expired", Date.parse("2026-08-29T12:00:00.000Z")), null);
  assert.equal((await loadImportPreview("active", Date.parse("2026-08-29T12:00:00.000Z")))?.importBatchId, "active");
});

test("removes a Preview after commit or explicit abandonment", async () => {
  await saveImportPreview(previewFixture("batch-1", "2026-08-30T00:00:00.000Z"));
  await removeImportPreview("batch-1");
  assert.equal(await loadImportPreview("batch-1", Date.parse("2026-08-29T12:00:00.000Z")), null);
});

function previewFixture(importBatchId: string, expiresAt: string): DocxPreviewRecord {
  return {
    version: 1,
    importBatchId,
    createdAt: "2026-08-28T12:00:00.000Z",
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
