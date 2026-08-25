import assert from "node:assert/strict";
import test from "node:test";

import { chooseConflictResolution, hasRecoverablePublishedDraft } from "../lib/editor/conflict.ts";

const local = {
  title: "我的标题",
  markdown: "我的正文",
  tags: "随笔",
  attachmentIds: ["file-local"],
  baseRevisionId: "revision-17",
};
const online = {
  revisionId: "revision-18",
  title: "线上标题",
  markdown: "线上正文",
  tags: "线上标签",
  attachmentIds: ["file-online"],
};

test("published drafts prompt only when local content differs from the loaded server version", () => {
  assert.equal(hasRecoverablePublishedDraft(local, {
    title: "线上标题",
    markdown: "线上正文",
    tags: "线上标签",
    attachmentIds: ["file-online"],
    baseRevisionId: "revision-18",
  }), true);
  assert.equal(hasRecoverablePublishedDraft(local, { ...local }), false);
});

test("using the online version replaces content and advances the edit base", () => {
  assert.deepEqual(chooseConflictResolution("online", local, online), {
    mode: "online",
    title: "线上标题",
    markdown: "线上正文",
    tags: "线上标签",
    attachmentIds: ["file-online"],
    baseRevisionId: "revision-18",
    overwriteBaseRevisionId: null,
    conflictOpen: false,
  });
});

test("manual editing retains the local draft but blocks an ordinary stale save", () => {
  assert.deepEqual(chooseConflictResolution("manual", local, online), {
    mode: "manual",
    ...local,
    overwriteBaseRevisionId: null,
    conflictOpen: false,
    saveBlocked: true,
  });
});

test("explicit overwrite keeps local content and resubmits against the latest revision", () => {
  assert.deepEqual(chooseConflictResolution("overwrite", local, online), {
    mode: "overwrite",
    ...local,
    baseRevisionId: "revision-18",
    overwriteBaseRevisionId: "revision-18",
    conflictOpen: false,
    saveBlocked: false,
  });
});
