import assert from "node:assert/strict";
import test from "node:test";
import { buildAnnotationReplyLifecycleViews, planAnnotationAdminTransition, planAnnotationAuthorDelete, planImportedAnnotationThreadRemoval } from "../lib/annotations/lifecycle.ts";

const root = { id: "a", postId: "p", authorId: "a", contentMarkdown: "root", originalSelectedText: "text", createdAt: new Date(), createdOnRevisionId: "r", submissionKey: "k", deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null, hiddenReason: null };
type ReplyFixture = {
  id: string; annotationId: string; authorId: string | null; replyToUserId: string | null; replyToReplyId: string | null;
  contentMarkdown: string; submissionKey: string; createdAt: Date; deletedAt: Date | null; deletedByUserId: string | null;
  hiddenAt: Date | null; hiddenByUserId: string | null; hiddenReason: string | null;
  sourceType: "NATIVE" | "DOCX_IMPORT"; importedByUserId: string | null;
};
const reply = (overrides: Partial<ReplyFixture> = {}): ReplyFixture => ({ id: "r1", annotationId: "a", authorId: "b", replyToUserId: "a", replyToReplyId: null, contentMarkdown: "reply", submissionKey: "k", createdAt: new Date(), deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null, hiddenReason: null, sourceType: "NATIVE", importedByUserId: null, ...overrides });

test("deleting a root removes its anchor only when no other member discussion depends on it", () => {
  assert.equal(planAnnotationAuthorDelete(root, [], "a", new Date()).retainAnchor, false);
  assert.equal(planAnnotationAuthorDelete(root, [reply()], "a", new Date()).retainAnchor, true);
  assert.equal(planAnnotationAuthorDelete(root, [reply({ hiddenAt: new Date(), hiddenByUserId: "admin" })], "a", new Date()).retainAnchor, true);
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

test("administrator moderation snapshots current roots but not reply-only visibility", () => {
  const hiddenRoot = planAnnotationAdminTransition({ targetType: "ANNOTATION", targetId: "a", record: root, administratorId: "admin", operation: "hide", operationId: "op-a", reason: "越界", currentAnchor: true, now: new Date(10) });
  assert.equal(hiddenRoot.createAnnotationStateRevision, true);
  assert.equal(hiddenRoot.audit?.actionType, "ANNOTATION_HIDDEN");
  assert.equal("hiddenReason" in hiddenRoot.patch ? hiddenRoot.patch.hiddenReason : null, "越界");

  const hiddenReply = planAnnotationAdminTransition({ targetType: "ANNOTATION_REPLY", targetId: "r1", record: reply(), administratorId: "admin", operation: "hide", operationId: "op-r", currentAnchor: true, now: new Date(20) });
  assert.equal(hiddenReply.createAnnotationStateRevision, false);
  assert.equal(hiddenReply.audit?.actionType, "ANNOTATION_REPLY_HIDDEN");
});

test("imported thread removal unwraps without native replies and retains native discussion without cascading", () => {
  const importedRoot = { ...root, authorId: null, sourceType: "DOCX_IMPORT" as const, importedByUserId: "importer" };
  const importedReply = reply({ id: "word-reply", authorId: null, sourceType: "DOCX_IMPORT", importedByUserId: "importer" });
  const nativeReply = reply({ id: "native-reply", authorId: "member", sourceType: "NATIVE" });

  const withoutNative = planImportedAnnotationThreadRemoval(importedRoot, [importedReply], {
    actorUserId: "importer",
    postAuthorId: "importer",
    now: new Date(100),
  });
  assert.equal(withoutNative.retainAnchor, false);
  assert.deepEqual(withoutNative.importedReplyIds, ["word-reply"]);

  const withNative = planImportedAnnotationThreadRemoval(importedRoot, [importedReply, nativeReply], {
    actorUserId: "importer",
    postAuthorId: "importer",
    now: new Date(200),
  });
  assert.equal(withNative.retainAnchor, true);
  assert.deepEqual(withNative.importedReplyIds, ["word-reply"]);
  assert.equal(withNative.importedReplyIds.includes("native-reply"), false);
});

test("imported thread removal rejects attribution and native roots while admin moderation remains available", () => {
  const importedRoot = { ...root, authorId: null, sourceType: "DOCX_IMPORT" as const, importedByUserId: "importer" };
  assert.throws(() => planImportedAnnotationThreadRemoval(importedRoot, [], {
    actorUserId: "attributed",
    postAuthorId: "post-author",
    now: new Date(),
  }), /不能移除/);
  assert.throws(() => planImportedAnnotationThreadRemoval({ ...root, sourceType: "NATIVE" as const, importedByUserId: null }, [], {
    actorUserId: "a",
    postAuthorId: "a",
    now: new Date(),
  }), /不是 Word 导入/);

  const hidden = planAnnotationAdminTransition({ targetType: "ANNOTATION", targetId: "a", record: importedRoot, administratorId: "admin", operation: "hide", operationId: "op", currentAnchor: true, now: new Date() });
  assert.equal(hidden.changed, true);
  assert.equal(hidden.createAnnotationStateRevision, true);
});
