import assert from "node:assert/strict";
import test from "node:test";
import { planAnnotationReplyCreation } from "../lib/annotations/transaction.ts";

test("annotation replies stay one visual layer and notify the actual target", () => {
  const plan = planAnnotationReplyCreation({ id: "a", postId: "p", authorId: "root", hiddenAt: null, currentAnchorIds: ["a"] }, { actorUserId: "c", targetReply: { id: "b-reply", annotationId: "a", authorId: "b", deletedAt: null, hiddenAt: null } }, new Date());
  assert.equal(plan.visualDepth, 1);
  assert.equal(plan.replyToReplyId, "b-reply");
  assert.equal(plan.replyToUserId, "b");
  assert.equal(plan.notificationRecipientUserId, "b");
});

test("reply creation rejects detached, hidden, cross-thread, or unavailable targets", () => {
  const root = { id: "a", postId: "p", authorId: "root", hiddenAt: null, currentAnchorIds: ["a"] };
  assert.throws(() => planAnnotationReplyCreation({ ...root, currentAnchorIds: [] }, { actorUserId: "b", targetReply: null }, new Date()), /不属于当前正文/);
  assert.throws(() => planAnnotationReplyCreation({ ...root, hiddenAt: new Date() }, { actorUserId: "b", targetReply: null }, new Date()), /不可回复/);
  assert.throws(() => planAnnotationReplyCreation(root, { actorUserId: "b", targetReply: { id: "x", annotationId: "other", authorId: "c", deletedAt: null, hiddenAt: null } }, new Date()), /不属于当前批注/);
});
