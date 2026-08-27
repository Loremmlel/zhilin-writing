import assert from "node:assert/strict";
import test from "node:test";
import { buildAnnotationReplyLifecycleViews, planAnnotationAuthorDelete } from "../lib/annotations/lifecycle.ts";

const root = { id: "a", postId: "p", authorId: "a", contentMarkdown: "root", originalSelectedText: "text", createdAt: new Date(), createdOnRevisionId: "r", submissionKey: "k", deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null, hiddenReason: null };
const reply = (overrides: Record<string, unknown> = {}) => ({ id: "r1", annotationId: "a", authorId: "b", replyToUserId: "a", replyToReplyId: null, contentMarkdown: "reply", submissionKey: "k", createdAt: new Date(), deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null, hiddenReason: null, ...overrides });

test("deleting a root removes its anchor only when no other member discussion depends on it", () => {
  assert.equal(planAnnotationAuthorDelete(root, [], "a", new Date()).retainAnchor, false);
  assert.equal(planAnnotationAuthorDelete(root, [reply()], "a", new Date()).retainAnchor, true);
  assert.equal(planAnnotationAuthorDelete(root, [reply({ authorId: "a" })], "a", new Date()).retainAnchor, false);
});

test("deleted replies remain only when a visible direct reply depends on them", () => {
  const deleted = reply({ id: "r1", deletedAt: new Date(), deletedByUserId: "b" });
  assert.deepEqual(buildAnnotationReplyLifecycleViews([deleted]), []);
  const views = buildAnnotationReplyLifecycleViews([deleted, reply({ id: "r2", authorId: "c", replyToReplyId: "r1" })]);
  assert.equal(views[0]?.contentVisible, false);
  assert.match(views[0]?.placeholder ?? "", /作者删除/);
  assert.equal(views.length, 2);
});
