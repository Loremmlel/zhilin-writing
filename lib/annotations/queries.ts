import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { annotationReplies, annotations, postAnnotationAnchors } from "@/db/schema";

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
