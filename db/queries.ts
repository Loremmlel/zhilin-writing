import { and, asc, count, desc, eq, inArray, isNull, like, ne, or } from "drizzle-orm";

import { getDb } from "./index";
import { activityEvents, allowedUsers, assets, notifications, postTags, posts, replies, tags, users } from "./schema";

export type PostSort = "latest" | "active";

const visiblePost = and(isNull(posts.deletedAt), isNull(posts.hiddenAt));

export async function allowlistCount(): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(allowedUsers);
  return row?.value ?? 0;
}

export async function findAllowedUser(email: string) {
  return (await getDb().select().from(allowedUsers).where(eq(allowedUsers.email, email)).limit(1))[0] ?? null;
}

export async function addAllowedUser(email: string, isAdmin: boolean, addedByUserId?: string) {
  const record = {
    id: crypto.randomUUID(),
    email,
    isAdmin,
    addedAt: new Date(),
    addedByUserId: addedByUserId ?? null,
  };
  await getDb().insert(allowedUsers).values(record);
  return record;
}

export async function ensureConfiguredAdministrator(email: string) {
  const db = getDb();
  const administrator = {
    id: crypto.randomUUID(),
    email,
    isAdmin: true,
    addedAt: new Date(),
    addedByUserId: null,
  };

  await db.batch([
    db
      .insert(allowedUsers)
      .values(administrator)
      .onConflictDoUpdate({
        target: allowedUsers.email,
        set: { isAdmin: true },
      }),
    db
      .delete(allowedUsers)
      .where(and(ne(allowedUsers.email, email), isNull(allowedUsers.addedByUserId))),
    db
      .update(allowedUsers)
      .set({ isAdmin: false })
      .where(ne(allowedUsers.email, email)),
  ]);

  return findAllowedUser(email);
}

export async function removeAllowedUser(id: string) {
  await getDb().delete(allowedUsers).where(and(eq(allowedUsers.id, id), eq(allowedUsers.isAdmin, false)));
}

export async function listAllowedUsers() {
  return getDb().select().from(allowedUsers).orderBy(desc(allowedUsers.isAdmin), asc(allowedUsers.email));
}

export async function findUserByEmail(emailKey: string) {
  return (await getDb().select().from(users).where(eq(users.emailKey, emailKey)).limit(1))[0] ?? null;
}

export async function findUserById(id: string) {
  return (await getDb().select().from(users).where(eq(users.id, id)).limit(1))[0] ?? null;
}

export async function listUsers() {
  return getDb().select().from(users).orderBy(asc(users.joinedAt));
}

export async function isDisplayNameTaken(displayName: string, exceptUserId?: string) {
  const row = (await getDb().select({ id: users.id }).from(users).where(eq(users.displayName, displayName)).limit(1))[0];
  return Boolean(row && row.id !== exceptUserId);
}

export async function createUserProfile(input: { emailKey: string; displayName: string; bio: string }) {
  const now = new Date();
  const user = {
    id: crypto.randomUUID(),
    emailKey: input.emailKey,
    displayName: input.displayName,
    bio: input.bio,
    avatarAssetId: null,
    joinedAt: now,
    updatedAt: now,
  };
  await getDb().insert(users).values(user);
  return user;
}

export async function updateUserProfile(id: string, input: { displayName: string; bio: string; avatarAssetId?: string | null }) {
  await getDb().update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, id));
  return findUserById(id);
}

export async function listPosts(options: { sort?: PostSort; query?: string; authorId?: string; tagName?: string; limit?: number } = {}) {
  const conditions = [isNull(posts.deletedAt), isNull(posts.hiddenAt)];
  if (options.authorId) conditions.push(eq(posts.authorId, options.authorId));
  if (options.query?.trim()) {
    const pattern = `%${options.query.trim()}%`;
    conditions.push(or(like(posts.title, pattern), like(posts.searchText, pattern))!);
  }

  let postIds: string[] | null = null;
  if (options.tagName) {
    const tagged = await getDb()
      .select({ postId: postTags.postId })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(tags.normalizedName, options.tagName.toLocaleLowerCase("zh-CN")));
    postIds = tagged.map((row) => row.postId);
    if (postIds.length === 0) return [];
    conditions.push(inArray(posts.id, postIds));
  }

  const rows = await getDb()
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(...conditions))
    .orderBy(options.sort === "active" ? desc(posts.lastActivityAt) : desc(posts.publishedAt))
    .limit(options.limit ?? 40);

  return Promise.all(rows.map(async (row) => ({
    ...row,
    tags: await getTagsForPost(row.post.id),
    replyCount: await getReplyCount(row.post.id),
  })));
}

export async function getPost(id: string) {
  const row = (await getDb()
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(eq(posts.id, id), visiblePost))
    .limit(1))[0];
  if (!row) return null;
  return {
    ...row,
    tags: await getTagsForPost(id),
    attachments: await getDb().select().from(assets).where(and(eq(assets.postId, id), eq(assets.kind, "attachment"), isNull(assets.deletedAt))),
  };
}

export async function getTagsForPost(postId: string) {
  return getDb()
    .select({ id: tags.id, name: tags.name, normalizedName: tags.normalizedName })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, postId))
    .orderBy(asc(tags.name));
}

export async function getReplyCount(postId: string): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(replies).where(and(eq(replies.postId, postId), isNull(replies.deletedAt), isNull(replies.hiddenAt)));
  return row?.value ?? 0;
}

export async function listReplies(postId: string) {
  const rows = await getDb()
    .select({ reply: replies, author: users })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .where(and(eq(replies.postId, postId), isNull(replies.deletedAt), isNull(replies.hiddenAt)))
    .orderBy(asc(replies.publishedAt));

  return Promise.all(rows.map(async (row) => ({
    ...row,
    replyTo: row.reply.replyToUserId ? await findUserById(row.reply.replyToUserId) : null,
  })));
}

export async function findReply(id: string) {
  return (await getDb().select().from(replies).where(eq(replies.id, id)).limit(1))[0] ?? null;
}

export async function findReplyBySubmissionKey(authorId: string, submissionKey: string) {
  return (await getDb().select().from(replies).where(and(eq(replies.authorId, authorId), eq(replies.submissionKey, submissionKey))).limit(1))[0] ?? null;
}

export async function listUserActivity(actorUserId: string, limit = 50) {
  const rows = await getDb()
    .select({ event: activityEvents, actor: users, post: posts, reply: replies })
    .from(activityEvents)
    .innerJoin(users, eq(activityEvents.actorUserId, users.id))
    .leftJoin(posts, eq(activityEvents.postId, posts.id))
    .leftJoin(replies, eq(activityEvents.replyId, replies.id))
    .where(and(eq(activityEvents.actorUserId, actorUserId), isNull(activityEvents.invalidatedAt)))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);

  return Promise.all(rows.map(async (row) => ({
    ...row,
    replyTo: row.event.replyToUserId ? await findUserById(row.event.replyToUserId) : null,
    postAvailable: Boolean(row.post && !row.post.deletedAt && !row.post.hiddenAt),
    replyAvailable: Boolean(row.reply && !row.reply.deletedAt && !row.reply.hiddenAt),
  })));
}

export async function countUnreadNotifications(recipientUserId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

export async function listNotifications(recipientUserId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  const conditions = [eq(notifications.recipientUserId, recipientUserId)];
  if (options.unreadOnly) conditions.push(isNull(notifications.readAt));
  const rows = await getDb()
    .select({ notification: notifications, event: activityEvents, actor: users, post: posts, reply: replies })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.eventId, activityEvents.id))
    .innerJoin(users, eq(notifications.actorUserId, users.id))
    .leftJoin(posts, eq(notifications.postId, posts.id))
    .leftJoin(replies, eq(notifications.replyId, replies.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(options.limit ?? 60);

  return rows.map((row) => ({
    ...row,
    postAvailable: Boolean(row.post && !row.post.deletedAt && !row.post.hiddenAt),
    replyAvailable: Boolean(row.reply && !row.reply.deletedAt && !row.reply.hiddenAt),
  }));
}

export async function findOwnedNotification(id: string, recipientUserId: string) {
  const row = (await getDb()
    .select({ notification: notifications, event: activityEvents, actor: users, post: posts, reply: replies })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.eventId, activityEvents.id))
    .innerJoin(users, eq(notifications.actorUserId, users.id))
    .leftJoin(posts, eq(notifications.postId, posts.id))
    .leftJoin(replies, eq(notifications.replyId, replies.id))
    .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, recipientUserId)))
    .limit(1))[0];
  if (!row) return null;
  return {
    ...row,
    postAvailable: Boolean(row.post && !row.post.deletedAt && !row.post.hiddenAt),
    replyAvailable: Boolean(row.reply && !row.reply.deletedAt && !row.reply.hiddenAt),
  };
}

export async function markNotificationRead(id: string, recipientUserId: string) {
  await getDb().update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.id, id),
    eq(notifications.recipientUserId, recipientUserId),
    isNull(notifications.readAt),
  ));
}

export async function markAllNotificationsRead(recipientUserId: string) {
  await getDb().update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.recipientUserId, recipientUserId),
    isNull(notifications.readAt),
  ));
}

export async function listTags() {
  const rows = await getDb().select().from(tags).orderBy(asc(tags.name));
  return Promise.all(rows.map(async (tag) => {
    const [result] = await getDb().select({ value: count() }).from(postTags).where(eq(postTags.tagId, tag.id));
    return { ...tag, postCount: result?.value ?? 0 };
  }));
}

export async function findAsset(id: string) {
  return (await getDb().select().from(assets).where(and(eq(assets.id, id), isNull(assets.deletedAt))).limit(1))[0] ?? null;
}

export async function listAssetsForOwner(ownerId: string, status?: "temporary" | "permanent") {
  const conditions = [eq(assets.ownerId, ownerId), isNull(assets.deletedAt)];
  if (status) conditions.push(eq(assets.status, status));
  return getDb().select().from(assets).where(and(...conditions)).orderBy(desc(assets.createdAt));
}
