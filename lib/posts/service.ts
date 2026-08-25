import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { assets, posts, postTags, replies, tags } from "@/db/schema";
import { findReply, getPost } from "@/db/queries";
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
  await getDb().insert(posts).values({
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
  });
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

export async function createReply(input: { postId: string; authorId: string; markdown: string; targetReplyId?: string }) {
  const markdown = validateReplyMarkdown(input.markdown);
  let rootReplyId: string | null = null;
  let replyToUserId: string | null = null;
  if (input.targetReplyId) {
    const target = await findReply(input.targetReplyId);
    if (!target || target.postId !== input.postId) throw new Error("回复对象不存在");
    const normalized = normalizeReplyTarget({ id: target.id, rootReplyId: target.rootReplyId, authorId: target.authorId });
    rootReplyId = normalized.rootReplyId;
    replyToUserId = normalized.replyToUserId;
  }
  const now = new Date();
  await getDb().insert(replies).values({
    id: crypto.randomUUID(), postId: input.postId, authorId: input.authorId,
    rootReplyId, replyToUserId, markdown, publishedAt: now, deletedAt: null, hiddenAt: null,
  });
  await getDb().update(posts).set({ lastActivityAt: now }).where(eq(posts.id, input.postId));
}

export async function softDeleteReply(replyId: string, currentUserId: string) {
  await getDb().update(replies).set({ deletedAt: new Date() }).where(and(eq(replies.id, replyId), eq(replies.authorId, currentUserId)));
}
