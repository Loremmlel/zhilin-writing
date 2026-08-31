import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationReplyComposerLabel,
  buildAnnotationDiscussionItems,
  initialAnnotationReplyComposerState,
  nextAnnotationReplyComposerState,
  replyMarkdownAfterResult,
} from "../lib/annotations/reply-composer.ts";
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

test("replying to imported content creates no native recipient unless a native reply is targeted", () => {
  const importedRoot = { id: "a", postId: "p", authorId: null, hiddenAt: null, currentAnchorIds: ["a"] };
  const rootReply = planAnnotationReplyCreation(importedRoot, { actorUserId: "member", targetReply: null }, new Date());
  assert.equal(rootReply.replyToUserId, null);
  assert.equal(rootReply.notificationRecipientUserId, null);

  const importedReply = planAnnotationReplyCreation(importedRoot, { actorUserId: "member", targetReply: { id: "word-reply", annotationId: "a", authorId: null, deletedAt: null, hiddenAt: null } }, new Date());
  assert.equal(importedReply.notificationRecipientUserId, null);

  const nativeReply = planAnnotationReplyCreation(importedRoot, { actorUserId: "member", targetReply: { id: "native-reply", annotationId: "a", authorId: "native-author", deletedAt: null, hiddenAt: null } }, new Date());
  assert.equal(nativeReply.notificationRecipientUserId, "native-author");
});

test("one shared composer stays before reply 1 even with 100 replies", () => {
  const replies = Array.from({ length: 100 }, (_, index) => ({ id: `reply-${index + 1}` }));
  const items = buildAnnotationDiscussionItems(replies);
  assert.deepEqual(items.slice(0, 3), [
    { kind: "composer" },
    { kind: "reply-count", count: 100 },
    { kind: "reply", reply: { id: "reply-1" } },
  ]);
  assert.deepEqual(items.at(-1), { kind: "reply", reply: { id: "reply-100" } });
});

test("reply 37 retargets the single composer and only success clears its draft", () => {
  let state = initialAnnotationReplyComposerState();
  state = nextAnnotationReplyComposerState(state, { type: "reply", replyId: "reply-37", displayName: "林柚子" });
  assert.equal(state.open, true);
  assert.equal(annotationReplyComposerLabel(state), "回复 林柚子");
  assert.equal(replyMarkdownAfterResult("写到一半", { error: "网络失败" }), "写到一半");
  assert.equal(replyMarkdownAfterResult("写完了", { annotationReplyId: "created" }), "");
  state = nextAnnotationReplyComposerState(state, { type: "success" });
  assert.equal(annotationReplyComposerLabel(state), "回复这条批注");
});
