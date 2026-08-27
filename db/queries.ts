import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, ne, or } from "drizzle-orm";

import { getDb } from "./index";
import { adminAuditLog, activityEvents, allowedUsers, assets, notifications, postAssetRefs, postTags, posts, replies, tags, users } from "./schema";
import { canExposeActivitySnapshot, contentState } from "@/lib/lifecycle/policy";
import { buildPostLifecycleView, buildReplyLifecycleViews } from "@/lib/lifecycle/views";

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
    attachments: await getDb()
      .select({ asset: assets })
      .from(postAssetRefs)
      .innerJoin(assets, eq(postAssetRefs.assetId, assets.id))
      .where(and(
        eq(postAssetRefs.postId, id),
        eq(postAssetRefs.usage, "attachment"),
        isNull(assets.deletedAt),
      ))
      .then((rows) => rows.map((row) => row.asset)),
  };
}

async function getPostAttachments(id: string) {
  return getDb()
    .select({ asset: assets })
    .from(postAssetRefs)
    .innerJoin(assets, eq(postAssetRefs.assetId, assets.id))
    .where(and(
      eq(postAssetRefs.postId, id),
      eq(postAssetRefs.usage, "attachment"),
      isNull(assets.deletedAt),
    ))
    .then((rows) => rows.map((row) => row.asset));
}

export async function getPostDetail(id: string) {
  const row = (await getDb()
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(eq(posts.id, id))
    .limit(1))[0];
  if (!row) return null;
  const replyStates = await getDb().select({
    authorId: replies.authorId,
    deletedAt: replies.deletedAt,
    hiddenAt: replies.hiddenAt,
  }).from(replies).where(eq(replies.postId, id));
  const lifecycle = buildPostLifecycleView(row.post, replyStates);
  const base = {
    id: row.post.id,
    authorId: row.post.authorId,
    publishedAt: row.post.publishedAt,
    editedAt: row.post.editedAt,
    lastActivityAt: row.post.lastActivityAt,
    currentRevisionId: row.post.currentRevisionId,
    deletedAt: row.post.deletedAt,
    hiddenAt: row.post.hiddenAt,
  };
  return {
    post: base,
    author: row.author,
    lifecycle,
    title: lifecycle.contentVisible ? row.post.title : null,
    markdown: lifecycle.contentVisible ? row.post.markdown : null,
    tags: lifecycle.contentVisible ? await getTagsForPost(id) : [],
    attachments: lifecycle.contentVisible ? await getPostAttachments(id) : [],
  };
}

export async function getPostForAdministration(id: string) {
  const row = (await getDb()
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(eq(posts.id, id))
    .limit(1))[0];
  if (!row) return null;
  return {
    ...row,
    tags: await getTagsForPost(id),
    attachments: await getPostAttachments(id),
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
    .where(eq(replies.postId, postId))
    .orderBy(asc(replies.publishedAt));
  const lifecycleRows = buildReplyLifecycleViews(rows.map((row) => row.reply));
  const included = new Set(lifecycleRows.map((row) => row.id));
  const lifecycleById = new Map(lifecycleRows.map((row) => [row.id, row]));
  const replyById = new Map(rows.map((row) => [row.reply.id, row.reply]));
  return Promise.all(rows.filter((row) => included.has(row.reply.id)).map(async (row) => {
    const lifecycle = lifecycleById.get(row.reply.id)!;
    const directTarget = row.reply.replyToReplyId ? replyById.get(row.reply.replyToReplyId) : null;
    return {
      ...row,
      reply: lifecycle.contentVisible ? row.reply : { ...row.reply, markdown: "" },
      lifecycle: {
        state: lifecycle.state,
        contentVisible: lifecycle.contentVisible,
        placeholder: lifecycle.placeholder,
        visibleDependentCount: lifecycle.visibleDependentCount,
        visibleOtherAuthorDependentCount: lifecycle.visibleOtherAuthorDependentCount,
      },
      replyTo: row.reply.replyToUserId ? await findUserById(row.reply.replyToUserId) : null,
      replyToUnavailable: Boolean(directTarget && contentState(directTarget).state !== "normal"),
    };
  }));
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

  return Promise.all(rows.map(async (row) => {
    const postState = row.post ? contentState(row.post).state : "deleted";
    const replyState = row.reply ? contentState(row.reply).state : "deleted";
    const postReachable = row.post ? buildPostLifecycleView(row.post, await getDb().select({
      authorId: replies.authorId,
      deletedAt: replies.deletedAt,
      hiddenAt: replies.hiddenAt,
    }).from(replies).where(eq(replies.postId, row.post.id))).discussionReachable : false;
    const eventMetadataVisible = canExposeActivitySnapshot(postState, row.event.eventType, replyState);
    return {
      ...row,
      event: { ...row.event, metadataJson: eventMetadataVisible ? row.event.metadataJson : null },
      post: row.post ? { ...row.post, title: postState === "normal" ? row.post.title : "", markdown: "", searchText: "" } : null,
      reply: row.reply ? { ...row.reply, markdown: replyState === "normal" ? row.reply.markdown : "" } : null,
      replyTo: row.event.replyToUserId ? await findUserById(row.event.replyToUserId) : null,
      postAvailable: Boolean(row.post && postState === "normal"),
      postReachable,
      postState,
      replyAvailable: Boolean(row.reply && replyState === "normal"),
      replyState,
    };
  }));
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

  return Promise.all(rows.map((row) => lifecycleNotificationRow(row)));
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
  return lifecycleNotificationRow(row);
}

async function lifecycleNotificationRow<T extends {
  event: typeof activityEvents.$inferSelect;
  post: typeof posts.$inferSelect | null;
  reply: typeof replies.$inferSelect | null;
}>(row: T) {
  const postState = row.post ? contentState(row.post).state : "deleted";
  const replyState = row.reply ? contentState(row.reply).state : "deleted";
  const postReachable = row.post ? buildPostLifecycleView(row.post, await getDb().select({
    authorId: replies.authorId,
    deletedAt: replies.deletedAt,
    hiddenAt: replies.hiddenAt,
  }).from(replies).where(eq(replies.postId, row.post.id))).discussionReachable : false;
  const eventMetadataVisible = canExposeActivitySnapshot(postState, row.event.eventType, replyState);
  return {
    ...row,
    event: { ...row.event, metadataJson: eventMetadataVisible ? row.event.metadataJson : null },
    post: row.post ? { ...row.post, title: postState === "normal" ? row.post.title : "", markdown: "", searchText: "" } : null,
    reply: row.reply ? { ...row.reply, markdown: replyState === "normal" ? row.reply.markdown : "" } : null,
    postAvailable: Boolean(row.post && postState === "normal"),
    postReachable,
    postState,
    replyAvailable: Boolean(row.reply && replyState === "normal"),
    replyState,
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
  const counted = await Promise.all(rows.map(async (tag) => {
    const [result] = await getDb()
      .select({ value: count() })
      .from(postTags)
      .innerJoin(posts, eq(postTags.postId, posts.id))
      .where(and(eq(postTags.tagId, tag.id), visiblePost));
    return { ...tag, postCount: result?.value ?? 0 };
  }));
  return counted.filter((tag) => tag.postCount > 0);
}

export type AdminContentStatus = "normal" | "deleted" | "hidden";

function lifecycleStatusCondition(status: AdminContentStatus, table: typeof posts | typeof replies) {
  if (status === "deleted") return isNotNull(table.deletedAt);
  if (status === "hidden") return isNotNull(table.hiddenAt);
  return and(isNull(table.deletedAt), isNull(table.hiddenAt));
}

export async function listAdminPosts(status: AdminContentStatus, limit = 100) {
  return getDb().select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(lifecycleStatusCondition(status, posts))
    .orderBy(desc(posts.publishedAt))
    .limit(limit);
}

export async function listAdminReplies(status: AdminContentStatus, limit = 100) {
  return getDb().select({ reply: replies, author: users, post: posts })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .innerJoin(posts, eq(replies.postId, posts.id))
    .where(lifecycleStatusCondition(status, replies))
    .orderBy(desc(replies.publishedAt))
    .limit(limit);
}

export async function listAdminAuditLog(limit = 60) {
  return getDb().select({ audit: adminAuditLog, administrator: users })
    .from(adminAuditLog)
    .innerJoin(users, eq(adminAuditLog.adminUserId, users.id))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit);
}

export async function findAsset(id: string) {
  return (await getDb().select().from(assets).where(and(eq(assets.id, id), isNull(assets.deletedAt))).limit(1))[0] ?? null;
}

export async function listAssetsForOwner(ownerId: string, status?: "temporary" | "permanent") {
  const conditions = [eq(assets.ownerId, ownerId), isNull(assets.deletedAt)];
  if (status) conditions.push(eq(assets.status, status));
  return getDb().select().from(assets).where(and(...conditions)).orderBy(desc(assets.createdAt));
}
