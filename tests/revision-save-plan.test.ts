import assert from "node:assert/strict";
import test from "node:test";

import { planContentSave, planRestore } from "../lib/revisions/save-plan.ts";
import { buildAssetSnapshot } from "../lib/revisions/policy.ts";

const current = {
  revisionId: "revision-3",
  revisionNumber: 3,
  title: "当前标题",
  markdown: "当前正文",
  assetRefs: buildAssetSnapshot("当前正文", ["file-a"]),
  editedAt: new Date(3000),
  lastActivityAt: new Date(2000),
};

test("a tags-only save creates no revision and preserves both timestamps", () => {
  assert.deepEqual(planContentSave(current, {
    title: current.title,
    markdown: current.markdown,
    assetRefs: current.assetRefs,
  }, new Date(4000)), {
    kind: "metadata-only",
    currentRevisionId: "revision-3",
    editedAt: new Date(3000),
    lastActivityAt: new Date(2000),
  });
});

test("a content save advances once, edits now, and never bumps activity", () => {
  assert.deepEqual(planContentSave(current, {
    title: "修改标题",
    markdown: current.markdown,
    assetRefs: current.assetRefs,
  }, new Date(4000)), {
    kind: "new-revision",
    revisionNumber: 4,
    editedAt: new Date(4000),
    lastActivityAt: new Date(2000),
  });
});

test("restore copies the historical snapshot into a new revision without activity", () => {
  const source = {
    id: "revision-1",
    title: "最初标题",
    markdown: "最初正文",
    assetRefs: buildAssetSnapshot("最初正文", ["file-old"]),
  };
  assert.deepEqual(planRestore(current, source, new Date(5000)), {
    kind: "new-revision",
    revisionNumber: 4,
    title: "最初标题",
    markdown: "最初正文",
    assetRefs: source.assetRefs,
    restoreSourceRevisionId: "revision-1",
    editedAt: new Date(5000),
    lastActivityAt: new Date(2000),
  });
});
