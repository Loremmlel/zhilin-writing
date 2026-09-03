import assert from "node:assert/strict";
import test from "node:test";

import {
  notificationTargetNotice,
  parseNotificationTargetState,
  resolveNotificationTarget,
  targetHrefWithNotice,
} from "../lib/notifications/target-resolution.ts";

test("notification target resolution distinguishes lifecycle, history, post access and missing data", () => {
  const base = {
    kind: "ANNOTATION_REPLY" as const,
    postExists: true,
    postReachable: true,
    targetState: "normal" as const,
    annotationCurrent: true,
  };
  assert.equal(resolveNotificationTarget(base).state, "AVAILABLE");
  assert.equal(
    resolveNotificationTarget({ ...base, targetState: "deleted" }).state,
    "DELETED_BY_AUTHOR",
  );
  assert.equal(
    resolveNotificationTarget({ ...base, targetState: "hidden" }).state,
    "HIDDEN_BY_ADMIN",
  );
  assert.equal(
    resolveNotificationTarget({ ...base, annotationCurrent: false }).state,
    "NOT_IN_CURRENT_REVISION",
  );
  assert.equal(
    resolveNotificationTarget({ ...base, postReachable: false }).state,
    "POST_UNAVAILABLE",
  );
  assert.equal(resolveNotificationTarget({ ...base, targetState: null }).state, "NOT_FOUND");
});

test("target lifecycle takes precedence over historical membership and preserves canonical wording", () => {
  assert.equal(
    resolveNotificationTarget({
      kind: "ANNOTATION",
      postExists: true,
      postReachable: true,
      targetState: "hidden",
      annotationCurrent: false,
    }).state,
    "HIDDEN_BY_ADMIN",
  );
  assert.equal(
    resolveNotificationTarget({
      kind: "ANNOTATION",
      postExists: true,
      postReachable: true,
      targetState: "deleted",
      annotationCurrent: false,
    }).state,
    "DELETED_BY_AUTHOR",
  );
  assert.equal(notificationTargetNotice("DELETED_BY_AUTHOR", "ANNOTATION"), "该批注已被作者删除。");
  assert.equal(
    notificationTargetNotice("HIDDEN_BY_ADMIN", "ANNOTATION_REPLY"),
    "该回复已被管理员隐藏。",
  );
  assert.equal(
    notificationTargetNotice("NOT_IN_CURRENT_REVISION", "ANNOTATION"),
    "该内容存在于历史版本中，但当前版本已不再包含它。",
  );
});

test("unavailable target URLs retain stable IDs while adding a typed notice", () => {
  const href =
    "/posts/post-a?target=annotation-reply&annotation=ann-a&annotationReply=reply-b#annotation-reply-reply-b";
  assert.equal(
    targetHrefWithNotice(href, "DELETED_BY_AUTHOR"),
    "/posts/post-a?target=annotation-reply&annotation=ann-a&annotationReply=reply-b&notice=deleted-by-author#annotation-reply-reply-b",
  );
  assert.equal(parseNotificationTargetState("deleted-by-author"), "DELETED_BY_AUTHOR");
  assert.equal(parseNotificationTargetState("made-up"), null);
});
