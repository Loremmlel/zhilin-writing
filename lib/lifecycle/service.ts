import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { adminAuditLog, posts, replies } from "@/db/schema";
import { deriveLastActivityAt } from "./policy";
import {
  planAdminLifecycleTransition,
  planAuthorDelete,
  type AdminLifecycleAction,
  type LifecycleRecord,
} from "./transitions";

function asBatch(items: BatchItem<"sqlite">[]) {
  if (items.length === 0) throw new Error("生命周期事务不能为空");
  return items as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
}

async function findPostRecord(postId: string) {
  return (await getDb().select().from(posts).where(eq(posts.id, postId)).limit(1))[0] ?? null;
}

async function findReplyRecord(replyId: string) {
  return (await getDb().select().from(replies).where(eq(replies.id, replyId)).limit(1))[0] ?? null;
}

async function derivePostActivityAfterReplyChange(
  postId: string,
  replyId: string,
  patch: Partial<Pick<LifecycleRecord, "deletedAt" | "hiddenAt">>,
) {
  const db = getDb();
  const [post, replyRows] = await Promise.all([
    db.select({ publishedAt: posts.publishedAt }).from(posts).where(eq(posts.id, postId)).limit(1).then((rows) => rows[0]),
    db.select({ id: replies.id, publishedAt: replies.publishedAt, deletedAt: replies.deletedAt, hiddenAt: replies.hiddenAt })
      .from(replies)
      .where(eq(replies.postId, postId)),
  ]);
  if (!post) throw new Error("帖子不存在");
  return deriveLastActivityAt(post.publishedAt, replyRows.map((reply) => (
    reply.id === replyId ? { ...reply, ...patch } : reply
  )));
}

function insertAuditOperation(
  audit: NonNullable<ReturnType<typeof planAdminLifecycleTransition>["audit"]>,
) {
  return getDb().insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminUserId: audit.adminUserId,
    actionType: audit.actionType,
    targetType: audit.targetType,
    targetId: audit.targetId,
    createdAt: audit.createdAt,
    metadataJson: audit.metadataJson,
    dedupeKey: audit.dedupeKey,
  }).onConflictDoNothing({ target: adminAuditLog.dedupeKey });
}

export async function deletePostByAuthor(postId: string, actorUserId: string) {
  const post = await findPostRecord(postId);
  if (!post) throw new Error("帖子不存在");
  const plan = planAuthorDelete(post, actorUserId, new Date());
  if (!plan.changed) return { changed: false as const };
  await getDb().update(posts).set(plan.patch).where(and(
    eq(posts.id, postId),
    eq(posts.authorId, actorUserId),
    isNull(posts.deletedAt),
  ));
  return { changed: true as const };
}

export async function deleteReplyByAuthor(replyId: string, actorUserId: string) {
  const reply = await findReplyRecord(replyId);
  if (!reply) throw new Error("回复不存在");
  const plan = planAuthorDelete(reply, actorUserId, new Date());
  if (!plan.changed) return { changed: false as const, postId: reply.postId };
  const lastActivityAt = await derivePostActivityAfterReplyChange(reply.postId, reply.id, plan.patch);
  const db = getDb();
  await db.batch(asBatch([
    db.update(replies).set(plan.patch).where(and(
      eq(replies.id, replyId),
      eq(replies.authorId, actorUserId),
      isNull(replies.deletedAt),
    )),
    db.update(posts).set({ lastActivityAt }).where(eq(posts.id, reply.postId)),
  ]));
  return { changed: true as const, postId: reply.postId };
}

async function transitionPost(
  postId: string,
  adminUserId: string,
  actionType: Extract<AdminLifecycleAction, `POST_${string}`>,
  reason?: string,
  operationId?: string,
) {
  const post = await findPostRecord(postId);
  if (!post) throw new Error("帖子不存在");
  const plan = planAdminLifecycleTransition(actionType, "POST", postId, post, adminUserId, new Date(), reason, operationId);
  if (!plan.changed || !plan.audit) return { changed: false as const };
  const db = getDb();
  const lifecycleGuard = actionType === "POST_HIDDEN"
    ? isNull(posts.hiddenAt)
    : actionType === "POST_UNHIDDEN"
      ? isNotNull(posts.hiddenAt)
      : isNotNull(posts.deletedAt);
  const operations: BatchItem<"sqlite">[] = [
    db.update(posts).set(plan.patch).where(and(eq(posts.id, postId), lifecycleGuard)),
    insertAuditOperation(plan.audit),
  ];
  if (actionType === "POST_RESTORED") {
    const publicReplies = await db.select({ publishedAt: replies.publishedAt, deletedAt: replies.deletedAt, hiddenAt: replies.hiddenAt })
      .from(replies)
      .where(eq(replies.postId, postId));
    operations.push(db.update(posts).set({
      lastActivityAt: deriveLastActivityAt(post.publishedAt, publicReplies),
    }).where(eq(posts.id, postId)));
  }
  await db.batch(asBatch(operations));
  return { changed: true as const };
}

async function transitionReply(
  replyId: string,
  adminUserId: string,
  actionType: Extract<AdminLifecycleAction, `REPLY_${string}`>,
  reason?: string,
  operationId?: string,
) {
  const reply = await findReplyRecord(replyId);
  if (!reply) throw new Error("回复不存在");
  const plan = planAdminLifecycleTransition(actionType, "REPLY", replyId, reply, adminUserId, new Date(), reason, operationId);
  if (!plan.changed || !plan.audit) return { changed: false as const, postId: reply.postId };
  const lastActivityAt = await derivePostActivityAfterReplyChange(reply.postId, reply.id, plan.patch);
  const db = getDb();
  const lifecycleGuard = actionType === "REPLY_HIDDEN"
    ? isNull(replies.hiddenAt)
    : actionType === "REPLY_UNHIDDEN"
      ? isNotNull(replies.hiddenAt)
      : isNotNull(replies.deletedAt);
  await db.batch(asBatch([
    db.update(replies).set(plan.patch).where(and(eq(replies.id, replyId), lifecycleGuard)),
    db.update(posts).set({ lastActivityAt }).where(eq(posts.id, reply.postId)),
    insertAuditOperation(plan.audit),
  ]));
  return { changed: true as const, postId: reply.postId };
}

export const restorePostByAdmin = (postId: string, adminUserId: string, operationId?: string) => transitionPost(postId, adminUserId, "POST_RESTORED", undefined, operationId);
export const hidePostByAdmin = (postId: string, adminUserId: string, reason?: string, operationId?: string) => transitionPost(postId, adminUserId, "POST_HIDDEN", reason, operationId);
export const unhidePostByAdmin = (postId: string, adminUserId: string, operationId?: string) => transitionPost(postId, adminUserId, "POST_UNHIDDEN", undefined, operationId);
export const restoreReplyByAdmin = (replyId: string, adminUserId: string, operationId?: string) => transitionReply(replyId, adminUserId, "REPLY_RESTORED", undefined, operationId);
export const hideReplyByAdmin = (replyId: string, adminUserId: string, reason?: string, operationId?: string) => transitionReply(replyId, adminUserId, "REPLY_HIDDEN", reason, operationId);
export const unhideReplyByAdmin = (replyId: string, adminUserId: string, operationId?: string) => transitionReply(replyId, adminUserId, "REPLY_UNHIDDEN", undefined, operationId);
