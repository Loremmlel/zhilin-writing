import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAssetSnapshot,
  classifyPostChange,
  nextRevisionNumber,
  resolveSaveBase,
} from "../lib/revisions/policy.ts";

test("Markdown resource extraction deduplicates IDs and separates attachments", () => {
  const snapshot = buildAssetSnapshot(
    "![图 A](/api/assets/image-a)\n\n[附件](/api/assets/file-c)\n\n![重复](/api/assets/image-a)",
    ["file-c", "file-b", "file-b"],
  );

  assert.deepEqual(snapshot, [
    { assetId: "file-b", usage: "attachment" },
    { assetId: "file-c", usage: "attachment" },
    { assetId: "file-c", usage: "inline" },
    { assetId: "image-a", usage: "inline" },
  ]);
});

test("title, Markdown, inline resources, and attachment set create content revisions", () => {
  const current = {
    title: "原题",
    markdown: "正文 ![](/api/assets/image-a)",
    assetRefs: buildAssetSnapshot("正文 ![](/api/assets/image-a)", ["file-a"]),
  };

  assert.equal(classifyPostChange(current, { ...current, title: "新题" }).contentChanged, true);
  assert.equal(classifyPostChange(current, { ...current, markdown: "新正文" }).contentChanged, true);
  assert.equal(classifyPostChange(current, {
    ...current,
    markdown: "正文 ![](/api/assets/image-b)",
    assetRefs: buildAssetSnapshot("正文 ![](/api/assets/image-b)", ["file-a"]),
  }).contentChanged, true);
  assert.equal(classifyPostChange(current, {
    ...current,
    assetRefs: buildAssetSnapshot(current.markdown, ["file-b"]),
  }).contentChanged, true);
  assert.equal(classifyPostChange(current, { ...current }).contentChanged, false);
});

test("optimistic locking accepts only the exact current revision", () => {
  assert.deepEqual(resolveSaveBase("revision-18", "revision-18"), {
    ok: true,
    acceptedBaseRevisionId: "revision-18",
  });
  assert.deepEqual(resolveSaveBase("revision-18", "revision-17"), {
    ok: false,
    currentRevisionId: "revision-18",
    code: "EDIT_CONFLICT",
  });
  assert.deepEqual(resolveSaveBase("revision-19", "revision-17", "revision-18"), {
    ok: false,
    currentRevisionId: "revision-19",
    code: "EDIT_CONFLICT",
  });
  assert.deepEqual(resolveSaveBase("revision-18", "revision-17", "revision-18"), {
    ok: true,
    acceptedBaseRevisionId: "revision-18",
  });
});

test("revision sequence always advances from the current maximum", () => {
  assert.equal(nextRevisionNumber(null), 1);
  assert.equal(nextRevisionNumber(1), 2);
  assert.equal(nextRevisionNumber(18), 19);
});
