import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { getPost } from "@/db/queries";
import { activityEvents, adminAuditLog, annotationReplies, annotations, notifications, postAnnotationAnchors, postRevisions, posts, revisionAnnotationStates, revisionAssetRefs } from "@/db/schema";
import { activityEventId, notificationId, truncateActivityPreview } from "@/lib/activity/policy";
import { derivePostActivityAfterInteractionChange } from "@/lib/lifecycle/service";
import { planAuthorDelete } from "@/lib/lifecycle/transitions";
import { getCurrentAssetRefs } from "@/lib/revisions/service";
import { findAnnotation, findAnnotationBySubmissionKey, findAnnotationReply, findAnnotationReplyBySubmissionKey, getCurrentAnnotationAnchorIds, getCurrentAnnotationStates } from "./queries";
import { collectAnnotationIds, parseAnnotationMarkdown, stringifyAnnotationMarkdown } from "./markdown";
import { planAnnotationAdminTransition, planAnnotationAuthorDelete } from "./lifecycle";
import { assertAnnotationBelongsToPost, assertAnchorInvariant, createAnnotationId, validateAnnotationContent, validateAnnotationReplyContent, validateAnnotationSubmissionKey } from "./policy";
import { unwrapAnnotation } from "./selection";
import { commitAnnotationMutation, planAnnotationCreation, planAnnotationReplyCreation } from "./transaction";
import type { AnnotationSelectionDescriptor } from "./types";

function asBatch(items: BatchItem<"sqlite">[]) {
  if (items.length === 0) throw new Error("批注事务不能为空");
  return items as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
}

export async function createAnnotation(input: {
  postId: string; authorId: string; baseRevisionId: string; selection: AnnotationSelectionDescriptor; contentMarkdown: string; submissionKey: string;
}): Promise<string> {
  const contentMarkdown = validateAnnotationContent(input.contentMarkdown);
  const submissionKey = validateAnnotationSubmissionKey(input.submissionKey);
  const duplicate = await findAnnotationBySubmissionKey(input.authorId, submissionKey);
  if (duplicate) return duplicate.id;
  const post = await getPost(input.postId);
  if (!post) throw new Error("帖子不存在或当前不可访问");
  if (!post.post.currentRevisionId) throw new Error("帖子当前版本不存在");
  const db = getDb();
  const currentRevision = (await db.select().from(postRevisions).where(and(eq(postRevisions.id, post.post.currentRevisionId), eq(postRevisions.postId, input.postId))).limit(1))[0];
  if (!currentRevision) throw new Error("帖子当前版本不存在");
  const [currentStates, currentAssetRefs] = await Promise.all([getCurrentAnnotationStates(input.postId), getCurrentAssetRefs(input.postId)]);
  const now = new Date();
  const annotationId = createAnnotationId();
  const revisionId = crypto.randomUUID();
  const plan = planAnnotationCreation({
    postId: input.postId, postAuthorId: post.post.authorId, actorUserId: input.authorId, title: post.post.title,
    markdown: post.post.markdown, currentRevisionId: currentRevision.id, currentRevisionNumber: currentRevision.revisionNumber,
    editedAt: post.post.editedAt, lastActivityAt: post.post.lastActivityAt, currentAnchorIds: currentStates.map((state) => state.annotationId),
  }, { baseRevisionId: input.baseRevisionId, annotationId, revisionId, selection: input.selection }, now);
  const eventId = activityEventId("ANNOTATION_CREATED", input.postId, annotationId);
  const operations: BatchItem<"sqlite">[] = [
    db.update(posts).set({ title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${input.baseRevisionId} AND ${posts.deletedAt} IS NULL AND ${posts.hiddenAt} IS NULL THEN ${posts.title} ELSE NULL END` }).where(eq(posts.id, input.postId)),
    db.insert(postRevisions).values({ id: revisionId, postId: input.postId, revisionNumber: plan.revisionNumber, kind: plan.revisionKind, title: plan.title, markdown: plan.markdown, createdAt: now, createdByUserId: input.authorId, restoreSourceRevisionId: null }),
    db.insert(annotations).values({ id: annotationId, postId: input.postId, authorId: input.authorId, contentMarkdown, originalSelectedText: plan.originalSelectedText, createdAt: now, createdOnRevisionId: revisionId, submissionKey, deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null, hiddenReason: null }),
    db.update(posts).set({ markdown: plan.markdown, currentRevisionId: revisionId, lastActivityAt: plan.lastActivityAt }).where(and(eq(posts.id, input.postId), eq(posts.currentRevisionId, input.baseRevisionId))),
    db.insert(postAnnotationAnchors).values({ postId: input.postId, annotationId }),
    ...currentAssetRefs.map((ref) => db.insert(revisionAssetRefs).values({ revisionId, ...ref })),
    ...currentStates.map((state) => db.insert(revisionAnnotationStates).values({ revisionId, ...state })),
    db.insert(revisionAnnotationStates).values({ revisionId, annotationId, deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null }),
    db.insert(activityEvents).values({ id: eventId, actorUserId: input.authorId, eventType: "ANNOTATION_CREATED", postId: input.postId, replyId: null, annotationId, annotationReplyId: null, rootReplyId: null, replyToUserId: null, metadataJson: JSON.stringify({ title: post.post.title, selectedText: truncateActivityPreview(plan.originalSelectedText, 48) }), createdAt: now, invalidatedAt: null }),
  ];
  if (plan.notificationRecipientUserId) operations.push(db.insert(notifications).values({
    id: notificationId(eventId, plan.notificationRecipientUserId, "POST_ANNOTATION_RECEIVED"), recipientUserId: plan.notificationRecipientUserId,
    actorUserId: input.authorId, eventId, notificationType: "POST_ANNOTATION_RECEIVED", postId: input.postId, replyId: null, annotationId, annotationReplyId: null, createdAt: now, readAt: null,
  }));
  try {
    await commitAnnotationMutation((items) => db.batch(asBatch(items)), operations);
  } catch (error) {
    const repeated = await findAnnotationBySubmissionKey(input.authorId, submissionKey);
    if (repeated) return repeated.id;
    const latest = (await db.select({ currentRevisionId: posts.currentRevisionId, deletedAt: posts.deletedAt, hiddenAt: posts.hiddenAt }).from(posts).where(eq(posts.id, input.postId)).limit(1))[0];
    if (!latest || latest.deletedAt || latest.hiddenAt) throw new Error("帖子不存在或当前不可访问");
    if (latest?.currentRevisionId !== input.baseRevisionId) throw new Error("帖子已更新，请重新选择文字后再批注");
    throw error;
  }
  return annotationId;
}

export async function createAnnotationReply(input: {
  postId: string; annotationId: string; authorId: string; targetReplyId?: string; contentMarkdown: string; submissionKey: string;
}): Promise<string> {
  const contentMarkdown = validateAnnotationReplyContent(input.contentMarkdown);
  const submissionKey = validateAnnotationSubmissionKey(input.submissionKey);
  const duplicate = await findAnnotationReplyBySubmissionKey(input.authorId, submissionKey);
  if (duplicate) return duplicate.id;
  const [annotation, post, currentAnchorIds, targetReply] = await Promise.all([
    findAnnotation(input.annotationId), getPost(input.postId), getCurrentAnnotationAnchorIds(input.postId),
    input.targetReplyId ? findAnnotationReply(input.targetReplyId) : Promise.resolve(null),
  ]);
  if (!post) throw new Error("帖子不存在或当前不可访问");
  if (!annotation || annotation.postId !== input.postId) throw new Error("批注不存在或不属于当前帖子");
  if (!post.post.currentRevisionId) throw new Error("帖子当前版本不存在");
  const now = new Date();
  const plan = planAnnotationReplyCreation({ id: annotation.id, postId: annotation.postId, authorId: annotation.authorId, hiddenAt: annotation.hiddenAt, currentAnchorIds }, { actorUserId: input.authorId, targetReply }, now);
  const id = crypto.randomUUID();
  const eventId = activityEventId("ANNOTATION_REPLY_CREATED", input.postId, id);
  const db = getDb();
  const operations: BatchItem<"sqlite">[] = [
    db.update(posts).set({ title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${post.post.currentRevisionId} AND ${posts.deletedAt} IS NULL AND ${posts.hiddenAt} IS NULL THEN ${posts.title} ELSE NULL END` }).where(eq(posts.id, input.postId)),
    ...(targetReply ? [db.update(annotationReplies).set({ contentMarkdown: sql<string>`CASE WHEN ${annotationReplies.annotationId} = ${annotation.id} AND ${annotationReplies.deletedAt} IS NULL AND ${annotationReplies.hiddenAt} IS NULL THEN ${annotationReplies.contentMarkdown} ELSE NULL END` }).where(eq(annotationReplies.id, targetReply.id))] : []),
    db.insert(annotationReplies).values({ id, annotationId: annotation.id, authorId: input.authorId, replyToUserId: plan.replyToUserId, replyToReplyId: plan.replyToReplyId, contentMarkdown, submissionKey, createdAt: now, deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null, hiddenReason: null }),
    db.update(posts).set({ lastActivityAt: now }).where(eq(posts.id, input.postId)),
    db.insert(activityEvents).values({ id: eventId, actorUserId: input.authorId, eventType: "ANNOTATION_REPLY_CREATED", postId: input.postId, replyId: null, annotationId: annotation.id, annotationReplyId: id, rootReplyId: null, replyToUserId: plan.replyToUserId, metadataJson: JSON.stringify({ title: post.post.title }), createdAt: now, invalidatedAt: null }),
  ];
  if (plan.notificationRecipientUserId) operations.push(db.insert(notifications).values({ id: notificationId(eventId, plan.notificationRecipientUserId, "ANNOTATION_REPLY_RECEIVED"), recipientUserId: plan.notificationRecipientUserId, actorUserId: input.authorId, eventId, notificationType: "ANNOTATION_REPLY_RECEIVED", postId: input.postId, replyId: null, annotationId: annotation.id, annotationReplyId: id, createdAt: now, readAt: null }));
  try { await commitAnnotationMutation((items) => db.batch(asBatch(items)), operations); }
  catch (error) {
    const repeated = await findAnnotationReplyBySubmissionKey(input.authorId, submissionKey);
    if (repeated) return repeated.id;
    const latestPost = (await db.select({ currentRevisionId: posts.currentRevisionId, deletedAt: posts.deletedAt, hiddenAt: posts.hiddenAt }).from(posts).where(eq(posts.id, input.postId)).limit(1))[0];
    if (!latestPost || latestPost.deletedAt || latestPost.hiddenAt) throw new Error("帖子不存在或当前不可访问");
    if (latestPost.currentRevisionId !== post.post.currentRevisionId) throw new Error("帖子已更新，请重新打开批注讨论后再回复");
    if (targetReply) {
      const latestTarget = await findAnnotationReply(targetReply.id);
      if (!latestTarget || latestTarget.annotationId !== annotation.id || latestTarget.deletedAt || latestTarget.hiddenAt) throw new Error("该回复当前不可回复");
    }
    throw error;
  }
  return id;
}

export async function deleteAnnotationByAuthor(postId: string, annotationId: string, actorUserId: string) {
  const annotation = await findAnnotation(annotationId);
  if (!annotation) throw new Error("批注不存在");
  assertAnnotationBelongsToPost(annotation.postId, postId);
  const db = getDb();
  const discussionReplies = await db.select().from(annotationReplies).where(eq(annotationReplies.annotationId, annotationId));
  const now = new Date();
  const lifecyclePlan = planAnnotationAuthorDelete(annotation, discussionReplies, actorUserId, now);
  if (!lifecyclePlan.changed) return { changed: false as const, postId: annotation.postId, retainedAnchor: false };
  const post = (await db.select().from(posts).where(eq(posts.id, annotation.postId)).limit(1))[0];
  if (!post?.currentRevisionId) throw new Error("帖子当前版本不存在");
  const currentRevision = (await db.select().from(postRevisions).where(eq(postRevisions.id, post.currentRevisionId)).limit(1))[0];
  if (!currentRevision) throw new Error("帖子当前版本不存在");
  const [currentStates, currentAssetRefs] = await Promise.all([getCurrentAnnotationStates(annotation.postId), getCurrentAssetRefs(annotation.postId)]);
  const currentAnchorIds = currentStates.map((state) => state.annotationId);
  if (!currentAnchorIds.includes(annotationId)) throw new Error("该批注不属于当前正文");
  const currentTree = parseAnnotationMarkdown(post.markdown);
  assertAnchorInvariant(collectAnnotationIds(currentTree), currentAnchorIds);
  const nextTree = lifecyclePlan.retainAnchor ? currentTree : unwrapAnnotation(currentTree, annotationId);
  const nextMarkdown = stringifyAnnotationMarkdown(nextTree);
  const nextStates = currentStates
    .filter((state) => lifecyclePlan.retainAnchor || state.annotationId !== annotationId)
    .map((state) => state.annotationId === annotationId ? { ...state, deletedAt: now, deletedByUserId: actorUserId } : state);
  assertAnchorInvariant(collectAnnotationIds(nextTree), nextStates.map((state) => state.annotationId));
  const lastActivityAt = await derivePostActivityAfterInteractionChange(annotation.postId, { kind: "annotation", id: annotationId, deletedAt: now, current: lifecyclePlan.retainAnchor });
  const revisionId = crypto.randomUUID();
  const operations: BatchItem<"sqlite">[] = [
    db.update(posts).set({ title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${currentRevision.id} THEN ${posts.title} ELSE NULL END` }).where(eq(posts.id, annotation.postId)),
    db.insert(postRevisions).values({ id: revisionId, postId: annotation.postId, revisionNumber: currentRevision.revisionNumber + 1, kind: "ANNOTATION_STATE", title: post.title, markdown: nextMarkdown, createdAt: now, createdByUserId: actorUserId, restoreSourceRevisionId: null }),
    db.update(annotations).set(lifecyclePlan.patch).where(and(eq(annotations.id, annotationId), eq(annotations.authorId, actorUserId), isNull(annotations.deletedAt))),
    db.update(posts).set({ markdown: nextMarkdown, currentRevisionId: revisionId, lastActivityAt }).where(and(eq(posts.id, annotation.postId), eq(posts.currentRevisionId, currentRevision.id))),
    ...(!lifecyclePlan.retainAnchor ? [db.delete(postAnnotationAnchors).where(and(eq(postAnnotationAnchors.postId, annotation.postId), eq(postAnnotationAnchors.annotationId, annotationId)))] : []),
    ...currentAssetRefs.map((ref) => db.insert(revisionAssetRefs).values({ revisionId, ...ref })),
    ...nextStates.map((state) => db.insert(revisionAnnotationStates).values({ revisionId, ...state })),
  ];
  await commitAnnotationMutation((items) => db.batch(asBatch(items)), operations);
  return { changed: true as const, postId: annotation.postId, retainedAnchor: lifecyclePlan.retainAnchor };
}

export async function deleteAnnotationReplyByAuthor(postId: string, replyId: string, actorUserId: string) {
  const reply = await findAnnotationReply(replyId);
  if (!reply) throw new Error("批注回复不存在");
  const annotation = await findAnnotation(reply.annotationId);
  if (!annotation) throw new Error("批注不存在");
  assertAnnotationBelongsToPost(annotation.postId, postId);
  const currentAnchorIds = await getCurrentAnnotationAnchorIds(postId);
  if (!currentAnchorIds.includes(annotation.id)) throw new Error("该批注不属于当前正文");
  const plan = planAuthorDelete(reply, actorUserId, new Date());
  if (!plan.changed) return { changed: false as const, postId: annotation.postId };
  const lastActivityAt = await derivePostActivityAfterInteractionChange(annotation.postId, { kind: "annotationReply", id: replyId, deletedAt: plan.patch.deletedAt });
  const db = getDb();
  await commitAnnotationMutation((items) => db.batch(asBatch(items)), [
    db.update(annotationReplies).set(plan.patch).where(and(eq(annotationReplies.id, replyId), eq(annotationReplies.authorId, actorUserId), isNull(annotationReplies.deletedAt))),
    db.update(posts).set({ lastActivityAt }).where(eq(posts.id, annotation.postId)),
  ]);
  return { changed: true as const, postId: annotation.postId };
}

export async function moderateAnnotationByAdmin(input: { annotationId: string; administratorId: string; operation: "hide" | "unhide"; operationId: string; reason?: string }) {
  const annotation = await findAnnotation(input.annotationId);
  if (!annotation) throw new Error("批注不存在");
  const db = getDb();
  const [currentStates, currentAssetRefs] = await Promise.all([getCurrentAnnotationStates(annotation.postId), getCurrentAssetRefs(annotation.postId)]);
  const currentAnchor = currentStates.some((state) => state.annotationId === annotation.id);
  const plan = planAnnotationAdminTransition({ targetType: "ANNOTATION", targetId: annotation.id, record: annotation, administratorId: input.administratorId, operation: input.operation, operationId: input.operationId, reason: input.reason, currentAnchor, now: new Date() });
  if (!plan.changed || !plan.audit) return { changed: false as const, postId: annotation.postId };
  const guard = input.operation === "hide" ? isNull(annotations.hiddenAt) : isNotNull(annotations.hiddenAt);
  const auditInsert = db.insert(adminAuditLog).values({ id: crypto.randomUUID(), ...plan.audit }).onConflictDoNothing({ target: adminAuditLog.dedupeKey });
  if (!plan.createAnnotationStateRevision) {
    await commitAnnotationMutation((items) => db.batch(asBatch(items)), [db.update(annotations).set(plan.patch).where(and(eq(annotations.id, annotation.id), guard)), auditInsert]);
    return { changed: true as const, postId: annotation.postId };
  }
  const post = (await db.select().from(posts).where(eq(posts.id, annotation.postId)).limit(1))[0];
  if (!post?.currentRevisionId) throw new Error("帖子当前版本不存在");
  const currentRevision = (await db.select().from(postRevisions).where(eq(postRevisions.id, post.currentRevisionId)).limit(1))[0];
  if (!currentRevision) throw new Error("帖子当前版本不存在");
  const revisionId = crypto.randomUUID();
  const nextStates = currentStates.map((state) => state.annotationId === annotation.id ? { ...state, ...plan.patch } : state);
  await commitAnnotationMutation((items) => db.batch(asBatch(items)), [
    db.update(posts).set({ title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${currentRevision.id} THEN ${posts.title} ELSE NULL END` }).where(eq(posts.id, annotation.postId)),
    db.insert(postRevisions).values({ id: revisionId, postId: annotation.postId, revisionNumber: currentRevision.revisionNumber + 1, kind: "ANNOTATION_STATE", title: post.title, markdown: post.markdown, createdAt: plan.audit.createdAt, createdByUserId: input.administratorId, restoreSourceRevisionId: null }),
    db.update(annotations).set(plan.patch).where(and(eq(annotations.id, annotation.id), guard)),
    db.update(posts).set({ currentRevisionId: revisionId }).where(and(eq(posts.id, annotation.postId), eq(posts.currentRevisionId, currentRevision.id))),
    ...currentAssetRefs.map((ref) => db.insert(revisionAssetRefs).values({ revisionId, ...ref })),
    ...nextStates.map((state) => db.insert(revisionAnnotationStates).values({ revisionId, ...state })),
    auditInsert,
  ]);
  return { changed: true as const, postId: annotation.postId };
}

export async function moderateAnnotationReplyByAdmin(input: { replyId: string; administratorId: string; operation: "hide" | "unhide"; operationId: string; reason?: string }) {
  const reply = await findAnnotationReply(input.replyId);
  if (!reply) throw new Error("批注回复不存在");
  const annotation = await findAnnotation(reply.annotationId);
  if (!annotation) throw new Error("批注不存在");
  const currentAnchorIds = await getCurrentAnnotationAnchorIds(annotation.postId);
  const plan = planAnnotationAdminTransition({ targetType: "ANNOTATION_REPLY", targetId: reply.id, record: reply, administratorId: input.administratorId, operation: input.operation, operationId: input.operationId, reason: input.reason, currentAnchor: currentAnchorIds.includes(annotation.id), now: new Date() });
  if (!plan.changed || !plan.audit) return { changed: false as const, postId: annotation.postId };
  const db = getDb();
  const guard = input.operation === "hide" ? isNull(annotationReplies.hiddenAt) : isNotNull(annotationReplies.hiddenAt);
  await commitAnnotationMutation((items) => db.batch(asBatch(items)), [
    db.update(annotationReplies).set(plan.patch).where(and(eq(annotationReplies.id, reply.id), guard)),
    db.insert(adminAuditLog).values({ id: crypto.randomUUID(), ...plan.audit }).onConflictDoNothing({ target: adminAuditLog.dedupeKey }),
  ]);
  return { changed: true as const, postId: annotation.postId };
}
