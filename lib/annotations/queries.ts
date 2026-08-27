import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { annotationReplies, annotations, postAnnotationAnchors, posts, users } from "@/db/schema";
import { contentState } from "@/lib/lifecycle/policy";
import { buildAnnotationReplyLifecycleViews } from "./lifecycle";

export async function findAnnotation(id: string) {
  return (await getDb().select().from(annotations).where(eq(annotations.id, id)).limit(1))[0] ?? null;
}

export async function findAnnotationBySubmissionKey(authorId: string, submissionKey: string) {
  return (await getDb().select().from(annotations).where(and(eq(annotations.authorId, authorId), eq(annotations.submissionKey, submissionKey))).limit(1))[0] ?? null;
}

export async function findAnnotationReply(id: string) {
  return (await getDb().select().from(annotationReplies).where(eq(annotationReplies.id, id)).limit(1))[0] ?? null;
}

export async function findAnnotationReplyBySubmissionKey(authorId: string, submissionKey: string) {
  return (await getDb().select().from(annotationReplies).where(and(eq(annotationReplies.authorId, authorId), eq(annotationReplies.submissionKey, submissionKey))).limit(1))[0] ?? null;
}

export async function getCurrentAnnotationStates(postId: string) {
  return getDb().select({
    annotationId: annotations.id, deletedAt: annotations.deletedAt, deletedByUserId: annotations.deletedByUserId,
    hiddenAt: annotations.hiddenAt, hiddenByUserId: annotations.hiddenByUserId,
  }).from(postAnnotationAnchors)
    .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
    .where(eq(postAnnotationAnchors.postId, postId))
    .orderBy(asc(annotations.createdAt), asc(annotations.id));
}

export async function getCurrentAnnotationAnchorIds(postId: string): Promise<string[]> {
  const rows = await getDb().select({ annotationId: postAnnotationAnchors.annotationId }).from(postAnnotationAnchors)
    .where(eq(postAnnotationAnchors.postId, postId)).orderBy(asc(postAnnotationAnchors.annotationId));
  return rows.map((row) => row.annotationId);
}

export async function postHasCurrentAnnotationAnchors(postId: string): Promise<boolean> {
  const row = (await getDb().select({ annotationId: postAnnotationAnchors.annotationId }).from(postAnnotationAnchors)
    .where(eq(postAnnotationAnchors.postId, postId)).limit(1))[0];
  return Boolean(row);
}

export async function listCurrentAnnotations(postId: string) {
  return getDb().select({ annotation: annotations, author: users }).from(postAnnotationAnchors)
    .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
    .innerJoin(users, eq(annotations.authorId, users.id))
    .where(eq(postAnnotationAnchors.postId, postId)).orderBy(asc(annotations.createdAt), asc(annotations.id));
}

export async function listCurrentAnnotationThreads(postId: string) {
  const roots = await listCurrentAnnotations(postId);
  const ids = roots.map((row) => row.annotation.id);
  if (ids.length === 0) return [];
  const replyRows = await getDb().select({ reply: annotationReplies, author: users }).from(annotationReplies)
    .innerJoin(users, eq(annotationReplies.authorId, users.id)).where(inArray(annotationReplies.annotationId, ids))
    .orderBy(asc(annotationReplies.createdAt), asc(annotationReplies.id));
  const targetIds = [...new Set(replyRows.map((row) => row.reply.replyToUserId).filter((id): id is string => Boolean(id)))];
  const targetUsers = targetIds.length ? await getDb().select().from(users).where(inArray(users.id, targetIds)) : [];
  const targetById = new Map(targetUsers.map((user) => [user.id, user]));
  return roots.map((root) => {
    const rootState = contentState(root.annotation).state;
    const threadRows = replyRows.filter((row) => row.reply.annotationId === root.annotation.id);
    const lifecycle = buildAnnotationReplyLifecycleViews(threadRows.map((row) => row.reply));
    const lifecycleById = new Map(lifecycle.map((reply) => [reply.id, reply]));
    return {
      ...root,
      annotation: rootState === "normal" ? root.annotation : { ...root.annotation, contentMarkdown: "" },
      lifecycle: { state: rootState, contentVisible: rootState === "normal", placeholder: rootState === "hidden" ? "该批注已被管理员隐藏。" : rootState === "deleted" ? "该批注已被作者删除。" : null },
      replies: threadRows.flatMap((row) => {
        const view = lifecycleById.get(row.reply.id);
        if (!view) return [];
        return [{ ...row, reply: view.contentVisible ? row.reply : { ...row.reply, contentMarkdown: "" }, lifecycle: view, replyTo: row.reply.replyToUserId ? targetById.get(row.reply.replyToUserId) ?? null : null }];
      }),
    };
  });
}

export type AnnotationAdminStatus = "normal" | "deleted" | "hidden";

export async function listAdminAnnotations(status: AnnotationAdminStatus, limit = 100) {
  const condition = status === "deleted" ? isNotNull(annotations.deletedAt) : status === "hidden" ? isNotNull(annotations.hiddenAt) : and(isNull(annotations.deletedAt), isNull(annotations.hiddenAt));
  return getDb().select({ annotation: annotations, author: users, post: posts }).from(annotations)
    .innerJoin(users, eq(annotations.authorId, users.id)).innerJoin(posts, eq(annotations.postId, posts.id))
    .where(condition).orderBy(desc(annotations.createdAt)).limit(limit);
}

export async function listAdminAnnotationReplies(status: AnnotationAdminStatus, limit = 100) {
  const condition = status === "deleted" ? isNotNull(annotationReplies.deletedAt) : status === "hidden" ? isNotNull(annotationReplies.hiddenAt) : and(isNull(annotationReplies.deletedAt), isNull(annotationReplies.hiddenAt));
  return getDb().select({ reply: annotationReplies, author: users, annotation: annotations, post: posts }).from(annotationReplies)
    .innerJoin(users, eq(annotationReplies.authorId, users.id)).innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id)).innerJoin(posts, eq(annotations.postId, posts.id))
    .where(condition).orderBy(desc(annotationReplies.createdAt)).limit(limit);
}
