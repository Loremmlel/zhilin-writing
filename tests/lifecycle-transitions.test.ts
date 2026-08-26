import assert from "node:assert/strict";
import test from "node:test";

import { planAuthorDelete, planAdminLifecycleTransition } from "../lib/lifecycle/transitions.ts";

const active = {
  authorId: "author",
  deletedAt: null,
  deletedByUserId: null,
  hiddenAt: null,
  hiddenByUserId: null,
  hiddenReason: null,
};

test("author delete is owner-only and an already deleted retry is a no-op", () => {
  const now = new Date(10_000);
  assert.throws(() => planAuthorDelete(active, "stranger", now), /只能删除自己的内容/);
  assert.deepEqual(planAuthorDelete(active, "author", now), {
    changed: true,
    patch: { deletedAt: now, deletedByUserId: "author" },
  });
  assert.deepEqual(planAuthorDelete({ ...active, deletedAt: now, deletedByUserId: "author" }, "author", new Date(11_000)), {
    changed: false,
    patch: {},
  });
});

test("restore and unhide clear only their own lifecycle state", () => {
  const deletedAt = new Date(8_000);
  const hiddenAt = new Date(9_000);
  const both = {
    ...active,
    deletedAt,
    deletedByUserId: "author",
    hiddenAt,
    hiddenByUserId: "admin",
    hiddenReason: "需要处理",
  };

  const restored = planAdminLifecycleTransition("POST_RESTORED", "POST", "post-1", both, "admin", new Date(10_000));
  assert.deepEqual(restored.patch, { deletedAt: null, deletedByUserId: null });
  assert.equal(restored.audit?.dedupeKey, "POST_RESTORED:POST:post-1:8000");

  const unhidden = planAdminLifecycleTransition("POST_UNHIDDEN", "POST", "post-1", both, "admin", new Date(10_000));
  assert.deepEqual(unhidden.patch, { hiddenAt: null, hiddenByUserId: null, hiddenReason: null });
  assert.equal(unhidden.audit?.dedupeKey, "POST_UNHIDDEN:POST:post-1:9000");
});

test("hide retries are idempotent and retain an earlier author deletion", () => {
  const now = new Date(10_000);
  const deleted = { ...active, deletedAt: new Date(8_000), deletedByUserId: "author" };
  const first = planAdminLifecycleTransition("REPLY_HIDDEN", "REPLY", "reply-1", deleted, "admin", now, "越界内容");
  assert.deepEqual(first.patch, { hiddenAt: now, hiddenByUserId: "admin", hiddenReason: "越界内容" });
  assert.equal(first.audit?.dedupeKey, "REPLY_HIDDEN:REPLY:reply-1:active");

  const retry = planAdminLifecycleTransition("REPLY_HIDDEN", "REPLY", "reply-1", {
    ...deleted,
    hiddenAt: now,
    hiddenByUserId: "admin",
    hiddenReason: "越界内容",
  }, "admin", new Date(11_000), "不同理由不会覆盖第一次隐藏");
  assert.deepEqual(retry, { changed: false, patch: {}, audit: null });
});

test("administrator operation IDs dedupe retries without collapsing later moderation cycles", () => {
  const first = planAdminLifecycleTransition("POST_HIDDEN", "POST", "post-1", active, "admin", new Date(10_000), undefined, "operation-1");
  const later = planAdminLifecycleTransition("POST_HIDDEN", "POST", "post-1", active, "admin", new Date(20_000), undefined, "operation-2");
  assert.equal(first.audit?.dedupeKey, "POST_HIDDEN:POST:post-1:operation-1");
  assert.equal(later.audit?.dedupeKey, "POST_HIDDEN:POST:post-1:operation-2");
});
