import assert from "node:assert/strict";
import test from "node:test";

import { DOCX_IMPORT_LIMITS } from "../lib/docx-import/limits.ts";
import { validateEditedImportPreview } from "../lib/docx-import/preview-validation.ts";
import type { DocxPreviewRecord } from "../lib/docx-import/types.ts";

const ROOT_ID = "ann_00000000-0000-4000-8000-000000000001";
const REPLY_ID = "00000000-0000-4000-8000-000000000002";

test("trims the title and preserves finalized import IDs in the commit payload", () => {
  const result = validateEditedImportPreview({
    ...previewFixture(),
    title: "  导入标题  ",
    markdown: `:annotation[正文]{#${ROOT_ID}}`,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.title, "导入标题");
  assert.equal(result.payload.ir.threads[0]?.annotationId, ROOT_ID);
  assert.equal(result.payload.ir.threads[0]?.replies[0]?.replyId, REPLY_ID);
});

test("blocks blank titles and Markdown above the UTF-8 byte limit", () => {
  const blank = validateEditedImportPreview({ ...editableFixture(), title: "   " });
  assert.equal(blank.ok, false);
  assert.ok(blank.errors.some((item) => item.code === "TITLE_REQUIRED"));

  const oversized = validateEditedImportPreview({
    ...editableFixture(),
    markdown: "中".repeat(Math.floor(DOCX_IMPORT_LIMITS.markdownUtf8Bytes / 3) + 1),
  });
  assert.equal(oversized.ok, false);
  assert.ok(oversized.errors.some((item) => item.code === "MARKDOWN_SIZE_LIMIT"));
});

test("blocks missing, unknown, and duplicate annotation anchors", () => {
  const missing = validateEditedImportPreview({ ...editableFixture(), markdown: "正文" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((item) => item.code === "ANNOTATION_ANCHOR_MISSING"));

  const unknown = validateEditedImportPreview({
    ...editableFixture(),
    markdown: ":annotation[正文]{#ann_00000000-0000-4000-8000-000000000099}",
  });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((item) => item.code === "ANNOTATION_ANCHOR_UNKNOWN"));

  const duplicate = validateEditedImportPreview({
    ...editableFixture(),
    markdown: `:annotation[正文]{#${ROOT_ID}}\n\n:annotation[正文]{#${ROOT_ID}}`,
  });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((item) => item.code === "ANNOTATION_ANCHOR_DUPLICATE"));
});

test("blocks edited annotation text, nested directives, and overlapping imported ranges", () => {
  const changed = validateEditedImportPreview({
    ...editableFixture(),
    markdown: `:annotation[正稿]{#${ROOT_ID}}`,
  });
  assert.equal(changed.ok, false);
  assert.ok(changed.errors.some((item) => item.code === "ANNOTATION_TEXT_CHANGED"));

  const nested = validateEditedImportPreview({
    ...editableFixture(),
    markdown: `:annotation[:annotation[正文]{#ann_00000000-0000-4000-8000-000000000099}]{#${ROOT_ID}}`,
  });
  assert.equal(nested.ok, false);
  assert.ok(nested.errors.some((item) => item.code === "ANNOTATION_NESTED"));

  const overlapFixture = editableFixture();
  overlapFixture.ir.threads.push({
    ...overlapFixture.ir.threads[0]!,
    annotationId: "ann_00000000-0000-4000-8000-000000000003",
    sourceCommentId: "12",
    blockLocalStart: 1,
    blockLocalEnd: 2,
    replies: [],
  });
  overlapFixture.markdown = `:annotation[正文]{#${ROOT_ID}}`;
  const overlap = validateEditedImportPreview(overlapFixture);
  assert.equal(overlap.ok, false);
  assert.ok(overlap.errors.some((item) => item.code === "ANNOTATION_OVERLAP"));
});

test("blocks unsafe external URLs and error-severity import warnings", () => {
  const unsafe = validateEditedImportPreview({
    ...editableFixture(),
    markdown: `:annotation[[正文](javascript:alert(1))]{#${ROOT_ID}}`,
  });
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.errors.some((item) => item.code === "UNSAFE_EXTERNAL_URL"));

  const warning = editableFixture();
  warning.ir.warnings = [{ code: "ANNOTATION_THREAD_SKIPPED", severity: "error" }];
  const blocked = validateEditedImportPreview(warning);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((item) => item.code === "IMPORT_WARNING_ERROR"));
});

test("blocks restored Previews with missing or tampered temporary image references", () => {
  const missing = editableFixture();
  missing.ir.assets = [{
    id: "docx-image-1",
    filename: "image.png",
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2, 3]),
    alt: "image",
    sourceRelationshipId: "rImage",
    floating: false,
  }];
  const missingResult = validateEditedImportPreview(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.errors.some((item) => item.code === "ASSET_UPLOAD_MISSING"));

  const tampered = editableFixture();
  tampered.temporaryAssets = [{
    assetId: "asset-1",
    temporaryUrl: "https://evil.example/image.png",
    filename: "image.png",
    mimeType: "image/png",
  }];
  const tamperedResult = validateEditedImportPreview(tampered);
  assert.equal(tamperedResult.ok, false);
  assert.ok(tamperedResult.errors.some((item) => item.code === "ASSET_REFERENCE_INVALID"));
});

function editableFixture() {
  return {
    ...previewFixture(),
    title: "导入标题",
    markdown: `:annotation[正文]{#${ROOT_ID}}`,
  };
}

function previewFixture(): DocxPreviewRecord {
  return {
    version: 1,
    importBatchId: "00000000-0000-4000-8000-000000000010",
    createdAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-30T00:00:00.000Z",
    ir: {
      version: 1,
      importBatchId: "00000000-0000-4000-8000-000000000010",
      source: { filename: "source.docx", producer: "Word", sha256: "source-hash" },
      suggestedTitle: "导入标题",
      blocks: [{
        id: "p1",
        type: "paragraph",
        segments: [{ text: "正文", marks: [], commentIds: ["10"] }],
      }],
      assets: [],
      threads: [{
        annotationId: ROOT_ID,
        sourceCommentId: "10",
        blockId: "p1",
        blockLocalStart: 0,
        blockLocalEnd: 2,
        sourceAuthorName: "Author",
        sourceDocumentOrder: 0,
        sourceResolved: false,
        bodyMarkdown: "Root",
        replies: [{
          replyId: REPLY_ID,
          sourceCommentId: "11",
          parentSourceCommentId: "10",
          sourceAuthorName: "Reply Author",
          sourceDocumentOrder: 1,
          sourceResolved: false,
          bodyMarkdown: "Reply",
        }],
      }],
      skippedThreads: [],
      warnings: [],
      canonicalMarkdown: `:annotation[正文]{#${ROOT_ID}}`,
    },
    canonicalMarkdown: `:annotation[正文]{#${ROOT_ID}}`,
    temporaryAssets: [],
    authorMappings: {},
  };
}
