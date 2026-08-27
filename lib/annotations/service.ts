import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { getPost } from "@/db/queries";
import { activityEvents, annotationReplies, annotations, notifications, postAnnotationAnchors, postRevisions, posts, revisionAnnotationStates, revisionAssetRefs } from "@/db/schema";
import { activityEventId, notificationId, truncateActivityPreview } from "@/lib/activity/policy";
import { getCurrentAssetRefs } from "@/lib/revisions/service";
import { findAnnotation, findAnnotationBySubmissionKey, findAnnotationReply, findAnnotationReplyBySubmissionKey, getCurrentAnnotationAnchorIds, getCurrentAnnotationStates } from "./queries";
import { createAnnotationId, validateAnnotationContent, validateAnnotationReplyContent, validateAnnotationSubmissionKey } from "./policy";
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
    db.update(posts).set({ title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${input.baseRevisionId} THEN ${posts.title} ELSE NULL END` }).where(eq(posts.id, input.postId)),
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
    const latest = (await db.select({ currentRevisionId: posts.currentRevisionId }).from(posts).where(eq(posts.id, input.postId)).limit(1))[0];
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
  const now = new Date();
  const plan = planAnnotationReplyCreation({ id: annotation.id, postId: annotation.postId, authorId: annotation.authorId, hiddenAt: annotation.hiddenAt, currentAnchorIds }, { actorUserId: input.authorId, targetReply }, now);
  const id = crypto.randomUUID();
  const eventId = activityEventId("ANNOTATION_REPLY_CREATED", input.postId, id);
  const db = getDb();
  const operations: BatchItem<"sqlite">[] = [
    db.insert(annotationReplies).values({ id, annotationId: annotation.id, authorId: input.authorId, replyToUserId: plan.replyToUserId, replyToReplyId: plan.replyToReplyId, contentMarkdown, submissionKey, createdAt: now, deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null, hiddenReason: null }),
    db.update(posts).set({ lastActivityAt: now }).where(eq(posts.id, input.postId)),
    db.insert(activityEvents).values({ id: eventId, actorUserId: input.authorId, eventType: "ANNOTATION_REPLY_CREATED", postId: input.postId, replyId: null, annotationId: annotation.id, annotationReplyId: id, rootReplyId: null, replyToUserId: plan.replyToUserId, metadataJson: JSON.stringify({ title: post.post.title }), createdAt: now, invalidatedAt: null }),
  ];
  if (plan.notificationRecipientUserId) operations.push(db.insert(notifications).values({ id: notificationId(eventId, plan.notificationRecipientUserId, "ANNOTATION_REPLY_RECEIVED"), recipientUserId: plan.notificationRecipientUserId, actorUserId: input.authorId, eventId, notificationType: "ANNOTATION_REPLY_RECEIVED", postId: input.postId, replyId: null, annotationId: annotation.id, annotationReplyId: id, createdAt: now, readAt: null }));
  try { await commitAnnotationMutation((items) => db.batch(asBatch(items)), operations); }
  catch (error) { const repeated = await findAnnotationReplyBySubmissionKey(input.authorId, submissionKey); if (repeated) return repeated.id; throw error; }
  return id;
}
