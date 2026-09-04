import type { BatchItem } from "drizzle-orm/batch";
import { count, eq, inArray, or } from "drizzle-orm";

import { getDb } from "@/db";
import {
  activityEvents,
  adminAuditLog,
  annotationReplies,
  annotations,
  assets,
  importBatches,
  notifications,
  postAnnotationAnchors,
  postAssetRefs,
  postRevisions,
  postTags,
  posts,
  replies,
  revisionAnnotationStates,
  revisionAssetRefs,
  revisionImportedReplyStates,
} from "@/db/schema";
import { validateCanonicalAnnotationDocument } from "@/lib/annotations/invariants";
import { adminAuditDedupeKey, deriveLastActivityAt } from "@/lib/lifecycle/policy";
import type { AdminContentType } from "./query";
import { removeAnnotationFromMarkdown, replyIdsForPurge } from "./purge-policy";

type PurgeAction = "POST_PURGED" | "REPLY_PURGED" | "ANNOTATION_PURGED" | "ANNOTATION_REPLY_PURGED";
type PurgeTarget = "POST" | "REPLY" | "ANNOTATION" | "ANNOTATION_REPLY";

function asBatch(items: BatchItem<"sqlite">[]) {
  if (items.length === 0) throw new Error("永久删除事务不能为空");
  return items as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
}

function auditOperation(input: {
  action: PurgeAction;
  target: PurgeTarget;
  targetId: string;
  administratorId: string;
  operationId: string;
  metadata: Record<string, number | string>;
}) {
  return getDb()
    .insert(adminAuditLog)
    .values({
      id: crypto.randomUUID(),
      adminUserId: input.administratorId,
      actionType: input.action,
      targetType: input.target,
      targetId: input.targetId,
      createdAt: new Date(),
      metadataJson: JSON.stringify(input.metadata),
      dedupeKey: adminAuditDedupeKey(input.action, input.target, input.targetId, input.operationId),
    })
    .onConflictDoNothing({ target: adminAuditLog.dedupeKey });
}

async function activityAfterPurge(
  postId: string,
  excluded: {
    replyIds?: Set<string>;
    annotationIds?: Set<string>;
    annotationReplyIds?: Set<string>;
  },
) {
  const db = getDb();
  const [post, replyRows, annotationRows, annotationReplyRows] = await Promise.all([
    db
      .select({ publishedAt: posts.publishedAt })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        id: replies.id,
        publishedAt: replies.publishedAt,
        deletedAt: replies.deletedAt,
        hiddenAt: replies.hiddenAt,
      })
      .from(replies)
      .where(eq(replies.postId, postId)),
    db
      .select({
        id: annotations.id,
        publishedAt: annotations.createdAt,
        deletedAt: annotations.deletedAt,
        hiddenAt: annotations.hiddenAt,
      })
      .from(postAnnotationAnchors)
      .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
      .where(eq(postAnnotationAnchors.postId, postId)),
    db
      .select({
        id: annotationReplies.id,
        annotationId: annotationReplies.annotationId,
        publishedAt: annotationReplies.createdAt,
        deletedAt: annotationReplies.deletedAt,
        hiddenAt: annotationReplies.hiddenAt,
      })
      .from(postAnnotationAnchors)
      .innerJoin(
        annotationReplies,
        eq(postAnnotationAnchors.annotationId, annotationReplies.annotationId),
      )
      .where(eq(postAnnotationAnchors.postId, postId)),
  ]);
  if (!post) throw new Error("帖子不存在");
  return deriveLastActivityAt(post.publishedAt, [
    ...replyRows.filter((row) => !excluded.replyIds?.has(row.id)),
    ...annotationRows.filter((row) => !excluded.annotationIds?.has(row.id)),
    ...annotationReplyRows.filter(
      (row) =>
        !excluded.annotationIds?.has(row.annotationId) && !excluded.annotationReplyIds?.has(row.id),
    ),
  ]);
}

async function purgePost(postId: string, administratorId: string, operationId: string) {
  const db = getDb();
  const post = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!post) return false;
  const [revisionCount, annotationCount, replyCount, annotationReplyCount, eventCount] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(postRevisions)
        .where(eq(postRevisions.postId, postId))
        .then((rows) => rows[0]?.value ?? 0),
      db
        .select({ value: count() })
        .from(annotations)
        .where(eq(annotations.postId, postId))
        .then((rows) => rows[0]?.value ?? 0),
      db
        .select({ value: count() })
        .from(replies)
        .where(eq(replies.postId, postId))
        .then((rows) => rows[0]?.value ?? 0),
      db
        .select({ value: count() })
        .from(annotationReplies)
        .innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id))
        .where(eq(annotations.postId, postId))
        .then((rows) => rows[0]?.value ?? 0),
      db
        .select({ value: count() })
        .from(activityEvents)
        .where(eq(activityEvents.postId, postId))
        .then((rows) => rows[0]?.value ?? 0),
    ]);
  const revisionIds = db
    .select({ id: postRevisions.id })
    .from(postRevisions)
    .where(eq(postRevisions.postId, postId));
  const annotationIds = db
    .select({ id: annotations.id })
    .from(annotations)
    .where(eq(annotations.postId, postId));
  const operations: BatchItem<"sqlite">[] = [
    db.delete(notifications).where(eq(notifications.postId, postId)),
    db.delete(activityEvents).where(eq(activityEvents.postId, postId)),
    db
      .delete(revisionAnnotationStates)
      .where(inArray(revisionAnnotationStates.revisionId, revisionIds)),
    db
      .delete(revisionImportedReplyStates)
      .where(inArray(revisionImportedReplyStates.revisionId, revisionIds)),
    db.delete(revisionAssetRefs).where(inArray(revisionAssetRefs.revisionId, revisionIds)),
    db.delete(postAnnotationAnchors).where(eq(postAnnotationAnchors.postId, postId)),
    db.delete(annotationReplies).where(inArray(annotationReplies.annotationId, annotationIds)),
    db.delete(annotations).where(eq(annotations.postId, postId)),
    db.delete(replies).where(eq(replies.postId, postId)),
    db.delete(postTags).where(eq(postTags.postId, postId)),
    db.delete(postAssetRefs).where(eq(postAssetRefs.postId, postId)),
    db.delete(importBatches).where(eq(importBatches.postId, postId)),
    db.update(assets).set({ postId: null }).where(eq(assets.postId, postId)),
    db.delete(postRevisions).where(eq(postRevisions.postId, postId)),
    db.delete(posts).where(eq(posts.id, postId)),
    auditOperation({
      action: "POST_PURGED",
      target: "POST",
      targetId: postId,
      administratorId,
      operationId,
      metadata: {
        replies: replyCount,
        annotations: annotationCount,
        annotationReplies: annotationReplyCount,
        revisions: revisionCount,
        events: eventCount,
      },
    }),
  ];
  await db.batch(asBatch(operations));
  return true;
}

async function purgeReply(replyId: string, administratorId: string, operationId: string) {
  const db = getDb();
  const target = await db
    .select({ id: replies.id, postId: replies.postId, rootReplyId: replies.rootReplyId })
    .from(replies)
    .where(eq(replies.id, replyId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!target) return false;
  const threadRows = target.rootReplyId
    ? [target]
    : await db
        .select({ id: replies.id, rootReplyId: replies.rootReplyId })
        .from(replies)
        .where(or(eq(replies.id, target.id), eq(replies.rootReplyId, target.id)));
  const deletedIds = replyIdsForPurge(target, threadRows);
  const replyCondition = target.rootReplyId
    ? eq(replies.id, target.id)
    : or(eq(replies.id, target.id), eq(replies.rootReplyId, target.id));
  const deletedReplyIds = db.select({ id: replies.id }).from(replies).where(replyCondition);
  const relatedEventIds = db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(inArray(activityEvents.replyId, deletedReplyIds));
  const lastActivityAt = await activityAfterPurge(target.postId, {
    replyIds: new Set(deletedIds),
  });
  await db.batch(
    asBatch([
      db
        .delete(notifications)
        .where(
          or(
            inArray(notifications.replyId, deletedReplyIds),
            inArray(notifications.eventId, relatedEventIds),
          ),
        ),
      db.delete(activityEvents).where(inArray(activityEvents.replyId, deletedReplyIds)),
      db
        .update(replies)
        .set({ replyToReplyId: null })
        .where(inArray(replies.replyToReplyId, deletedReplyIds)),
      db.delete(replies).where(replyCondition),
      db.update(posts).set({ lastActivityAt }).where(eq(posts.id, target.postId)),
      auditOperation({
        action: "REPLY_PURGED",
        target: "REPLY",
        targetId: replyId,
        administratorId,
        operationId,
        metadata: { replies: deletedIds.length, postId: target.postId },
      }),
    ]),
  );
  return true;
}

async function purgeAnnotation(annotationId: string, administratorId: string, operationId: string) {
  const db = getDb();
  const target = await db
    .select({ id: annotations.id, postId: annotations.postId })
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!target) return false;
  const [post, revisionRows, currentAnchorRows, replyCount] = await Promise.all([
    db
      .select({ markdown: posts.markdown })
      .from(posts)
      .where(eq(posts.id, target.postId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ id: postRevisions.id, markdown: postRevisions.markdown })
      .from(postRevisions)
      .where(eq(postRevisions.postId, target.postId)),
    db
      .select({ annotationId: postAnnotationAnchors.annotationId })
      .from(postAnnotationAnchors)
      .where(eq(postAnnotationAnchors.postId, target.postId)),
    db
      .select({ value: count() })
      .from(annotationReplies)
      .where(eq(annotationReplies.annotationId, annotationId))
      .then((rows) => rows[0]?.value ?? 0),
  ]);
  if (!post) throw new Error("所属帖子不存在");
  const replyIds = db
    .select({ id: annotationReplies.id })
    .from(annotationReplies)
    .where(eq(annotationReplies.annotationId, annotationId));
  const eventCondition = or(
    eq(activityEvents.annotationId, annotationId),
    inArray(activityEvents.annotationReplyId, replyIds),
  );
  const eventIds = db.select({ id: activityEvents.id }).from(activityEvents).where(eventCondition);
  const nextMarkdown = removeAnnotationFromMarkdown(post.markdown, annotationId);
  const remainingAnchorIds = currentAnchorRows
    .map((row) => row.annotationId)
    .filter((id) => id !== annotationId);
  const validation = validateCanonicalAnnotationDocument(nextMarkdown, remainingAnchorIds);
  if (!validation.ok) throw new Error("永久删除后的正文批注状态不一致");
  const lastActivityAt = await activityAfterPurge(target.postId, {
    annotationIds: new Set([annotationId]),
  });
  const operations: BatchItem<"sqlite">[] = [
    db.delete(notifications).where(inArray(notifications.eventId, eventIds)),
    db
      .delete(notifications)
      .where(
        or(
          eq(notifications.annotationId, annotationId),
          inArray(notifications.annotationReplyId, replyIds),
        ),
      ),
    db.delete(activityEvents).where(eventCondition),
    db
      .delete(revisionImportedReplyStates)
      .where(inArray(revisionImportedReplyStates.annotationReplyId, replyIds)),
    db
      .delete(revisionAnnotationStates)
      .where(eq(revisionAnnotationStates.annotationId, annotationId)),
    db.delete(postAnnotationAnchors).where(eq(postAnnotationAnchors.annotationId, annotationId)),
    db.delete(annotationReplies).where(eq(annotationReplies.annotationId, annotationId)),
    db.delete(annotations).where(eq(annotations.id, annotationId)),
    db
      .update(posts)
      .set({ markdown: nextMarkdown, lastActivityAt })
      .where(eq(posts.id, target.postId)),
  ];
  for (const revision of revisionRows) {
    const markdown = removeAnnotationFromMarkdown(revision.markdown, annotationId);
    if (markdown !== revision.markdown)
      operations.push(
        db.update(postRevisions).set({ markdown }).where(eq(postRevisions.id, revision.id)),
      );
  }
  operations.push(
    auditOperation({
      action: "ANNOTATION_PURGED",
      target: "ANNOTATION",
      targetId: annotationId,
      administratorId,
      operationId,
      metadata: {
        annotationReplies: replyCount,
        revisionsUpdated: revisionRows.filter(
          (revision) =>
            removeAnnotationFromMarkdown(revision.markdown, annotationId) !== revision.markdown,
        ).length,
        postId: target.postId,
      },
    }),
  );
  await db.batch(asBatch(operations));
  return true;
}

async function purgeAnnotationReply(replyId: string, administratorId: string, operationId: string) {
  const db = getDb();
  const target = await db
    .select({
      id: annotationReplies.id,
      annotationId: annotationReplies.annotationId,
      postId: annotations.postId,
    })
    .from(annotationReplies)
    .innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id))
    .where(eq(annotationReplies.id, replyId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!target) return false;
  const eventIds = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(eq(activityEvents.annotationReplyId, replyId))
    .then((rows) => rows.map((row) => row.id));
  const lastActivityAt = await activityAfterPurge(target.postId, {
    annotationReplyIds: new Set([replyId]),
  });
  await db.batch(
    asBatch([
      db
        .delete(notifications)
        .where(
          eventIds.length
            ? or(
                eq(notifications.annotationReplyId, replyId),
                inArray(notifications.eventId, eventIds),
              )
            : eq(notifications.annotationReplyId, replyId),
        ),
      db.delete(activityEvents).where(eq(activityEvents.annotationReplyId, replyId)),
      db
        .delete(revisionImportedReplyStates)
        .where(eq(revisionImportedReplyStates.annotationReplyId, replyId)),
      db
        .update(annotationReplies)
        .set({ replyToReplyId: null })
        .where(eq(annotationReplies.replyToReplyId, replyId)),
      db.delete(annotationReplies).where(eq(annotationReplies.id, replyId)),
      db.update(posts).set({ lastActivityAt }).where(eq(posts.id, target.postId)),
      auditOperation({
        action: "ANNOTATION_REPLY_PURGED",
        target: "ANNOTATION_REPLY",
        targetId: replyId,
        administratorId,
        operationId,
        metadata: { annotationId: target.annotationId, postId: target.postId },
      }),
    ]),
  );
  return true;
}

export async function purgeContentByAdmin(
  type: AdminContentType,
  id: string,
  administratorId: string,
  operationId: string,
) {
  if (type === "posts") return purgePost(id, administratorId, operationId);
  if (type === "replies") return purgeReply(id, administratorId, operationId);
  if (type === "annotations") return purgeAnnotation(id, administratorId, operationId);
  return purgeAnnotationReply(id, administratorId, operationId);
}
