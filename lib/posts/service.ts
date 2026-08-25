import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { activityEvents, assets, notifications, posts, postTags, replies, tags } from "@/db/schema";
import { findReply, findReplyBySubmissionKey, getPost } from "@/db/queries";
import { activityEventId, notificationId, resolveReplyRecipient, validateSubmissionKey } from "@/lib/activity/policy";
import { canEditPost, normalizeReplyTarget, validatePostInput, validateReplyMarkdown } from "@/lib/domain/rules";
import { markdownToPlainText } from "@/lib/markdown/render";

type SavePostInput = {
  title: string;
  markdown: string;
  tags: string[];
  assetIds?: string[];
};

async function replacePostTags(postId: string, names: string[]) {
  const db = getDb();
  await db.delete(postTags).where(eq(postTags.postId, postId));
  for (const name of names) {
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    let tag = (await db.select().from(tags).where(eq(tags.normalizedName, normalizedName)).limit(1))[0];
    if (!tag) {
      tag = { id: crypto.randomUUID(), name, normalizedName, createdAt: new Date() };
      await db.insert(tags).values(tag);
    }
    await db.insert(postTags).values({ postId, tagId: tag.id });
  }
}

async function bindAssets(postId: string, authorId: string, assetIds: string[] = []) {
  if (assetIds.length === 0) return;
  const now = new Date();
  for (const id of assetIds) {
    await getDb().update(assets).set({ postId, status: "permanent", boundAt: now, expiresAt: null }).where(and(eq(assets.id, id), eq(assets.ownerId, authorId)));
  }
}

export async function createPost(authorId: string, input: SavePostInput) {
  const clean = validatePostInput(input);
  const now = new Date();
  const id = crypto.randomUUID();
  const db = getDb();
  await db.batch([
    db.insert(posts).values({
      id,
      authorId,
      title: clean.title,
      markdown: clean.markdown,
      searchText: markdownToPlainText(clean.markdown),
      publishedAt: now,
      editedAt: null,
      lastActivityAt: now,
      deletedAt: null,
      hiddenAt: null,
    }),
    db.insert(activityEvents).values({
      id: activityEventId("POST_CREATED", id),
      actorUserId: authorId,
      eventType: "POST_CREATED",
      postId: id,
      replyId: null,
      rootReplyId: null,
      replyToUserId: null,
      metadataJson: null,
      createdAt: now,
      invalidatedAt: null,
    }),
  ]);
  await replacePostTags(id, clean.tags);
  await bindAssets(id, authorId, input.assetIds);
  return id;
}

export async function updatePost(postId: string, currentUserId: string, input: SavePostInput) {
  const existing = await getPost(postId);
  if (!existing) throw new Error("帖子不存在");
  if (!canEditPost(existing.post.authorId, currentUserId)) throw new Error("你不能编辑这篇帖子");
  const clean = validatePostInput(input);
  await getDb().update(posts).set({
    title: clean.title,
    markdown: clean.markdown,
    searchText: markdownToPlainText(clean.markdown),
    editedAt: new Date(),
  }).where(eq(posts.id, postId));
  await replacePostTags(postId, clean.tags);
  await bindAssets(postId, currentUserId, input.assetIds);
}

export async function createReply(input: { postId: string; authorId: string; markdown: string; submissionKey: string; targetReplyId?: string }) {
  const markdown = validateReplyMarkdown(input.markdown);
  const submissionKey = validateSubmissionKey(input.submissionKey);
  const duplicate = await findReplyBySubmissionKey(input.authorId, submissionKey);
  if (duplicate) return duplicate.id;

  const post = await getPost(input.postId);
  if (!post) throw new Error("帖子不存在");
  let rootReplyId: string | null = null;
  let replyToUserId: string | null = null;
  if (input.targetReplyId) {
    const target = await findReply(input.targetReplyId);
    if (!target || target.postId !== input.postId || target.deletedAt || target.hiddenAt) throw new Error("回复对象不存在");
    const normalized = normalizeReplyTarget({ id: target.id, rootReplyId: target.rootReplyId, authorId: target.authorId });
    rootReplyId = normalized.rootReplyId;
    replyToUserId = normalized.replyToUserId;
  }
  const now = new Date();
  const id = crypto.randomUUID();
  const eventId = activityEventId("POST_REPLY_CREATED", input.postId, id);
  const recipientUserId = resolveReplyRecipient({
    actorUserId: input.authorId,
    postAuthorId: post.post.authorId,
    replyToUserId,
  });
  const db = getDb();
  const replyInsert = db.insert(replies).values({
    id, postId: input.postId, authorId: input.authorId, rootReplyId, replyToUserId,
    submissionKey, markdown, publishedAt: now, deletedAt: null, hiddenAt: null,
  });
  const activityUpdate = db.update(posts).set({ lastActivityAt: now }).where(eq(posts.id, input.postId));
  const eventInsert = db.insert(activityEvents).values({
    id: eventId,
    actorUserId: input.authorId,
    eventType: "POST_REPLY_CREATED",
    postId: input.postId,
    replyId: id,
    rootReplyId,
    replyToUserId,
    metadataJson: null,
    createdAt: now,
    invalidatedAt: null,
  });

  try {
    if (recipientUserId) {
      await db.batch([
        replyInsert,
        activityUpdate,
        eventInsert,
        db.insert(notifications).values({
          id: notificationId(eventId, recipientUserId, "POST_REPLY_RECEIVED"),
          recipientUserId,
          actorUserId: input.authorId,
          eventId,
          notificationType: "POST_REPLY_RECEIVED",
          postId: input.postId,
          replyId: id,
          createdAt: now,
          readAt: null,
        }),
      ]);
    } else {
      await db.batch([replyInsert, activityUpdate, eventInsert]);
    }
  } catch (error) {
    const existing = await findReplyBySubmissionKey(input.authorId, submissionKey);
    if (existing) return existing.id;
    throw error;
  }
  return id;
}

export async function softDeleteReply(replyId: string, currentUserId: string) {
  await getDb().update(replies).set({ deletedAt: new Date() }).where(and(eq(replies.id, replyId), eq(replies.authorId, currentUserId)));
}
