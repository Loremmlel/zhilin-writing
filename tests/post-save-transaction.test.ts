import assert from "node:assert/strict";
import test from "node:test";

import { commitPostSave, planPostTags } from "../lib/posts/save-transaction.ts";

test("tag bindings reuse existing rows and assign stable IDs to new tags", () => {
  const first = planPostTags([" 校园 ", "阅读"], [{
    id: "existing-campus",
    name: "校园",
    normalizedName: "校园",
  }], new Date(1000));
  const second = planPostTags(["阅读"], [], new Date(2000));

  assert.equal(first.bindings[0]?.tagId, "existing-campus");
  assert.equal(first.newTags[0]?.id, second.newTags[0]?.id);
  assert.equal(first.newTags[0]?.normalizedName, "阅读");
});

test("one post save commits guard content annotations assets and tags in one batch", async () => {
  const calls: string[][] = [];
  await commitPostSave(async (items) => {
    calls.push(items);
  }, {
    guard: "revision-guard",
    content: ["post", "revision"],
    annotations: ["anchor", "retirement", "annotation-snapshot"],
    assets: ["asset-ref"],
    tags: ["tag", "post-tag"],
  });

  assert.deepEqual(calls, [[
    "revision-guard",
    "post",
    "revision",
    "anchor",
    "retirement",
    "annotation-snapshot",
    "asset-ref",
    "tag",
    "post-tag",
  ]]);
});

test("a failed guarded save cannot fall through to a separate tag write", async () => {
  let batchCalls = 0;
  await assert.rejects(() => commitPostSave(async () => {
    batchCalls += 1;
    throw new Error("EDIT_CONFLICT");
  }, {
    guard: "revision-guard",
    content: [],
    assets: [],
    tags: ["post-tag"],
  }), /EDIT_CONFLICT/);
  assert.equal(batchCalls, 1);
});
