import assert from "node:assert/strict";
import test from "node:test";

import {
  activityEventId,
  annotationTargetHref,
  canExposeAnnotationActivitySnapshot,
  notificationId,
  replyTargetHref,
  resolveReplyRecipient,
  truncateActivityPreview,
  validateSubmissionKey,
} from "../lib/activity/policy.ts";

test("business entity IDs make event and notification delivery idempotent", () => {
  assert.equal(activityEventId("POST_CREATED", "post-a"), "activity:post:post-a:created");
  assert.equal(activityEventId("POST_REPLY_CREATED", "post-a", "reply-b"), "activity:reply:reply-b:created");
  assert.equal(
    notificationId("activity:reply:reply-b:created", "user-a", "POST_REPLY_RECEIVED"),
    "notification:activity:reply:reply-b:created:user-a:post-reply-received",
  );
});

test("reply notifications go to the direct target and never to the actor", () => {
  assert.equal(resolveReplyRecipient({ actorUserId: "user-b", postAuthorId: "user-a", replyToUserId: null }), "user-a");
  assert.equal(resolveReplyRecipient({ actorUserId: "user-c", postAuthorId: "user-a", replyToUserId: "user-b" }), "user-b");
  assert.equal(resolveReplyRecipient({ actorUserId: "user-a", postAuthorId: "user-a", replyToUserId: null }), null);
  assert.equal(resolveReplyRecipient({ actorUserId: "user-b", postAuthorId: "user-a", replyToUserId: "user-b" }), null);
});

test("activity previews are whitespace-normalized and truncated by Unicode characters", () => {
  assert.equal(truncateActivityPreview("  我也\n有类似的感觉。  ", 20), "我也 有类似的感觉。");
  assert.equal(truncateActivityPreview("柚".repeat(7), 5), "柚柚柚柚柚…");
});

test("reply targets use a stable DOM anchor instead of text matching", () => {
  assert.equal(replyTargetHref("post-a", "reply-b"), "/posts/post-a#reply-reply-b");
});

test("annotation targets use the stable annotation id and redact unavailable snapshots", () => {
  assert.equal(annotationTargetHref("post-a", "ann-a"), "/posts/post-a?annotation=ann-a");
  assert.equal(canExposeAnnotationActivitySnapshot("normal", "normal", true), true);
  assert.equal(canExposeAnnotationActivitySnapshot("normal", "deleted", true), false);
  assert.equal(canExposeAnnotationActivitySnapshot("normal", "normal", false), false);
  assert.equal(canExposeAnnotationActivitySnapshot("hidden", "normal", true), false);
});

test("reply idempotency accepts UUID submissions and rejects forged keys", () => {
  assert.equal(validateSubmissionKey("6ba7b810-9dad-41d1-80b4-00c04fd430c8"), "6ba7b810-9dad-41d1-80b4-00c04fd430c8");
  assert.throws(() => validateSubmissionKey("repeat-my-reply"), /提交标识无效/);
});
