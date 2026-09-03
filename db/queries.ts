import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, ne, or } from "drizzle-orm";

import { getDb } from "./index";
import { adminAuditLog, activityEvents, allowedUsers, annotationReplies, annotations, assets, notifications, postAnnotationAnchors, postAssetRefs, postTags, posts, replies, tags, users } from "./schema";
import { canExposeActivitySnapshot, contentState } from "@/lib/lifecycle/policy";
import { buildPostLifecycleView, buildReplyLifecycleViews } from "@/lib/lifecycle/views";
import { canExposeAnnotationActivitySnapshot } from "@/lib/activity/policy";
import { parseDocxAttributionNoticeMetadata } from "@/lib/notifications/policy";
import { resolveNotificationTarget } from "@/lib/notifications/target-resolution";

export type PostSort = "latest" | "active";

const visiblePost = and(isNull(posts.deletedAt), isNull(posts.hiddenAt));

type DiscussionState = {
  authorId: string | null;
  deletedAt: Date | null;
  hiddenAt: Date | null;
};

type LifecycleQueryContext = {
  currentAnnotationKeys: Set<string>;
  discussionByPostId: Map<string, DiscussionState[]>;
};

function annotationKey(postId: string, annotationId: string): string {
  return `${postId}:${annotationId}`;
}

async function loadLifecycleQueryContext(postIdValues: string[]): Promise<LifecycleQueryContext> {
  const postIds = [...new Set(postIdValues)];
  if (postIds.length === 0) return { currentAnnotationKeys: new Set(), discussionByPostId: new Map() };
  const db = getDb();
  const [anchorRows, postReplyRows, annotationRows, annotationReplyRows] = await Promise.all([
    db.select({ postId: postAnnotationAnchors.postId, annotationId: postAnnotationAnchors.annotationId })
      .from(postAnnotationAnchors)
      .where(inArray(postAnnotationAnchors.postId, postIds)),
    db.select({ postId: replies.postId, authorId: replies.authorId, deletedAt: replies.deletedAt, hiddenAt: replies.hiddenAt })
      .from(replies)
      .where(inArray(replies.postId, postIds)),
    db.select({ postId: postAnnotationAnchors.postId, authorId: annotations.authorId, deletedAt: annotations.deletedAt, hiddenAt: annotations.hiddenAt })
      .from(postAnnotationAnchors)
      .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
      .where(inArray(postAnnotationAnchors.postId, postIds)),
    db.select({ postId: postAnnotationAnchors.postId, authorId: annotationReplies.authorId, deletedAt: annotationReplies.deletedAt, hiddenAt: annotationReplies.hiddenAt })
      .from(postAnnotationAnchors)
      .innerJoin(annotationReplies, eq(postAnnotationAnchors.annotationId, annotationReplies.annotationId))
      .where(inArray(postAnnotationAnchors.postId, postIds)),
  ]);
  const discussionByPostId = new Map<string, DiscussionState[]>();
  for (const row of [...postReplyRows, ...annotationRows, ...annotationReplyRows]) {
    const current = discussionByPostId.get(row.postId) ?? [];
    current.push({ authorId: row.authorId, deletedAt: row.deletedAt, hiddenAt: row.hiddenAt });
    discussionByPostId.set(row.postId, current);
  }
  return {
    currentAnnotationKeys: new Set(anchorRows.map((row) => annotationKey(row.postId, row.annotationId))),
    discussionByPostId,
  };
}

function contextAnnotationAvailable(context: LifecycleQueryContext, postId: string, annotationId: string | null): boolean {
  return Boolean(annotationId && context.currentAnnotationKeys.has(annotationKey(postId, annotationId)));
}

async function findUsersByIds(idValues: string[]) {
  const ids = [...new Set(idValues)];
  const chunks = Array.from({ length: Math.ceil(ids.length / 90) }, (_, index) => ids.slice(index * 90, index * 90 + 90));
  return (await Promise.all(chunks.map((chunk) => getDb().select().from(users).where(inArray(users.id, chunk))))).flat();
}

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

  if (options.tagName) {
    const tag = (await getDb().select({ id: tags.id }).from(tags)
      .where(eq(tags.normalizedName, options.tagName.toLocaleLowerCase("zh-CN"))).limit(1))[0];
    if (!tag) return [];
    conditions.push(inArray(posts.id, getDb().select({ postId: postTags.postId }).from(postTags).where(eq(postTags.tagId, tag.id))));
  }

  const rows = await getDb()
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(...conditions))
    .orderBy(options.sort === "active" ? desc(posts.lastActivityAt) : desc(posts.publishedAt))
    .limit(Math.min(Math.max(options.limit ?? 40, 1), 60));
  const ids = rows.map((row) => row.post.id);
  if (ids.length === 0) return [];
  const [tagRows, countRows] = await Promise.all([
    getDb().select({ postId: postTags.postId, id: tags.id, name: tags.name, normalizedName: tags.normalizedName })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(inArray(postTags.postId, ids))
      .orderBy(asc(tags.name)),
    getDb().select({ postId: replies.postId, value: count() })
      .from(replies)
      .where(and(inArray(replies.postId, ids), isNull(replies.deletedAt), isNull(replies.hiddenAt)))
      .groupBy(replies.postId),
  ]);
  const tagsByPostId = new Map<string, Array<{ id: string; name: string; normalizedName: string }>>();
  for (const tag of tagRows) tagsByPostId.set(tag.postId, [...(tagsByPostId.get(tag.postId) ?? []), { id: tag.id, name: tag.name, normalizedName: tag.normalizedName }]);
  const countByPostId = new Map(countRows.map((row) => [row.postId, row.value]));
  return rows.map((row) => ({
    ...row,
    tags: tagsByPostId.get(row.post.id) ?? [],
    replyCount: countByPostId.get(row.post.id) ?? 0,
  }));
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
  const replyStates = await getPostDiscussionStates(id);
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

async function getPostDiscussionStates(postId: string) {
  const [postReplies, annotationRoots, annotationThreadReplies] = await Promise.all([
    getDb().select({
      authorId: replies.authorId,
      deletedAt: replies.deletedAt,
      hiddenAt: replies.hiddenAt,
    }).from(replies).where(eq(replies.postId, postId)),
    getDb().select({
      authorId: annotations.authorId,
      deletedAt: annotations.deletedAt,
      hiddenAt: annotations.hiddenAt,
    }).from(postAnnotationAnchors)
      .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
      .where(eq(postAnnotationAnchors.postId, postId)),
    getDb().select({
      authorId: annotationReplies.authorId,
      deletedAt: annotationReplies.deletedAt,
      hiddenAt: annotationReplies.hiddenAt,
    }).from(postAnnotationAnchors)
      .innerJoin(annotationReplies, eq(postAnnotationAnchors.annotationId, annotationReplies.annotationId))
      .where(eq(postAnnotationAnchors.postId, postId)),
  ]);
  return [...postReplies, ...annotationRoots, ...annotationThreadReplies];
}

async function currentAnnotationAnchorAvailable(postId: string, annotationId: string | null) {
  if (!annotationId) return false;
  return Boolean((await getDb().select({ annotationId: postAnnotationAnchors.annotationId })
    .from(postAnnotationAnchors)
    .where(and(eq(postAnnotationAnchors.postId, postId), eq(postAnnotationAnchors.annotationId, annotationId)))
    .limit(1))[0]);
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

export async function listReplies(postId: string, options: { includeUnavailableReplyId?: string } = {}) {
  const rows = await getDb()
    .select({ reply: replies, author: users })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .where(eq(replies.postId, postId))
    .orderBy(asc(replies.publishedAt));
  const lifecycleRows = buildReplyLifecycleViews(rows.map((row) => row.reply), {
    requiredPlaceholderIds: options.includeUnavailableReplyId ? [options.includeUnavailableReplyId] : [],
  });
  const included = new Set(lifecycleRows.map((row) => row.id));
  const lifecycleById = new Map(lifecycleRows.map((row) => [row.id, row]));
  const replyById = new Map(rows.map((row) => [row.reply.id, row.reply]));
  const replyToIds = [...new Set(rows.map((row) => row.reply.replyToUserId).filter((id): id is string => Boolean(id)))];
  const replyToUsers = await findUsersByIds(replyToIds);
  const replyToById = new Map(replyToUsers.map((user) => [user.id, user]));
  return rows.filter((row) => included.has(row.reply.id)).map((row) => {
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
      replyTo: row.reply.replyToUserId ? replyToById.get(row.reply.replyToUserId) ?? null : null,
      replyToUnavailable: Boolean(directTarget && contentState(directTarget).state !== "normal"),
    };
  });
}

export async function findReply(id: string) {
  return (await getDb().select().from(replies).where(eq(replies.id, id)).limit(1))[0] ?? null;
}

export async function findReplyBySubmissionKey(authorId: string, submissionKey: string) {
  return (await getDb().select().from(replies).where(and(eq(replies.authorId, authorId), eq(replies.submissionKey, submissionKey))).limit(1))[0] ?? null;
}

export async function findPostByCreationSubmissionKey(authorId: string, submissionKey: string) {
  return (await getDb().select({ id: posts.id }).from(posts).where(and(
    eq(posts.authorId, authorId),
    eq(posts.creationSubmissionKey, submissionKey),
  )).limit(1))[0] ?? null;
}

export async function listUserActivity(actorUserId: string, limit = 50) {
  const rows = await getDb()
    .select({ event: activityEvents, actor: users, post: posts, reply: replies, annotation: annotations, annotationReply: annotationReplies })
    .from(activityEvents)
    .innerJoin(users, eq(activityEvents.actorUserId, users.id))
    .leftJoin(posts, eq(activityEvents.postId, posts.id))
    .leftJoin(replies, eq(activityEvents.replyId, replies.id))
    .leftJoin(annotations, eq(activityEvents.annotationId, annotations.id))
    .leftJoin(annotationReplies, eq(activityEvents.annotationReplyId, annotationReplies.id))
    .where(and(eq(activityEvents.actorUserId, actorUserId), isNull(activityEvents.invalidatedAt)))
    .orderBy(desc(activityEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  const replyToIds = rows.map((row) => row.event.replyToUserId).filter((id): id is string => Boolean(id));
  const [context, replyToUsers] = await Promise.all([
    loadLifecycleQueryContext(rows.flatMap((row) => row.post ? [row.post.id] : [])),
    findUsersByIds(replyToIds),
  ]);
  const replyToById = new Map(replyToUsers.map((user) => [user.id, user]));
  return rows.map((row) => {
    const postState = row.post ? contentState(row.post).state : "deleted";
    const replyState = row.reply ? contentState(row.reply).state : "deleted";
    const annotationState = row.annotation ? contentState(row.annotation).state : "deleted";
    const annotationReplyState = row.annotationReply ? contentState(row.annotationReply).state : "deleted";
    const annotationCurrent = row.post ? contextAnnotationAvailable(context, row.post.id, row.event.annotationId) : false;
    const postReachable = row.post ? buildPostLifecycleView(row.post, context.discussionByPostId.get(row.post.id) ?? []).discussionReachable : false;
    const annotationEvent = row.event.eventType === "ANNOTATION_CREATED" || row.event.eventType === "ANNOTATION_REPLY_CREATED";
    const annotationTargetState = row.event.eventType === "ANNOTATION_REPLY_CREATED" ? annotationReplyState : annotationState;
    const eventMetadataVisible = annotationEvent
      ? canExposeAnnotationActivitySnapshot(postState, annotationTargetState, annotationCurrent)
      : canExposeActivitySnapshot(postState, row.event.eventType, replyState);
    return {
      ...row,
      event: { ...row.event, metadataJson: eventMetadataVisible ? row.event.metadataJson : null },
      post: row.post ? { ...row.post, title: postState === "normal" ? row.post.title : "", markdown: "", searchText: "" } : null,
      reply: row.reply ? { ...row.reply, markdown: replyState === "normal" ? row.reply.markdown : "" } : null,
      annotation: row.annotation ? { ...row.annotation, contentMarkdown: annotationState === "normal" && annotationCurrent ? row.annotation.contentMarkdown : "", originalSelectedText: annotationState === "normal" && annotationCurrent ? row.annotation.originalSelectedText : "" } : null,
      annotationReply: row.annotationReply ? { ...row.annotationReply, contentMarkdown: annotationReplyState === "normal" && annotationCurrent ? row.annotationReply.contentMarkdown : "" } : null,
      replyTo: row.event.replyToUserId ? replyToById.get(row.event.replyToUserId) ?? null : null,
      postAvailable: Boolean(row.post && postState === "normal"),
      postReachable,
      postState,
      replyAvailable: Boolean(row.reply && replyState === "normal"),
      replyState,
      annotationCurrent,
      annotationAvailable: Boolean(row.annotation && annotationState === "normal" && annotationCurrent),
      annotationState,
      annotationReplyAvailable: Boolean(row.annotationReply && annotationReplyState === "normal" && annotationCurrent),
      annotationReplyState,
    };
  });
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
    .select({ notification: notifications, event: activityEvents, actor: users, post: posts, reply: replies, annotation: annotations, annotationReply: annotationReplies })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.eventId, activityEvents.id))
    .innerJoin(users, eq(notifications.actorUserId, users.id))
    .leftJoin(posts, eq(notifications.postId, posts.id))
    .leftJoin(replies, eq(notifications.replyId, replies.id))
    .leftJoin(annotations, eq(notifications.annotationId, annotations.id))
    .leftJoin(annotationReplies, eq(notifications.annotationReplyId, annotationReplies.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(Math.max(options.limit ?? 60, 1), 60));
  const context = await loadLifecycleQueryContext(
    rows.flatMap((row) => row.post ? [row.post.id] : []),
  );
  return Promise.all(rows.map((row) => lifecycleNotificationRow(row, context)));
}

export async function findOwnedNotification(id: string, recipientUserId: string) {
  const row = (await getDb()
    .select({ notification: notifications, event: activityEvents, actor: users, post: posts, reply: replies, annotation: annotations, annotationReply: annotationReplies })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.eventId, activityEvents.id))
    .innerJoin(users, eq(notifications.actorUserId, users.id))
    .leftJoin(posts, eq(notifications.postId, posts.id))
    .leftJoin(replies, eq(notifications.replyId, replies.id))
    .leftJoin(annotations, eq(notifications.annotationId, annotations.id))
    .leftJoin(annotationReplies, eq(notifications.annotationReplyId, annotationReplies.id))
    .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, recipientUserId)))
    .limit(1))[0];
  if (!row) return null;
  return lifecycleNotificationRow(row);
}

async function lifecycleNotificationRow<T extends {
  notification: typeof notifications.$inferSelect;
  event: typeof activityEvents.$inferSelect;
  post: typeof posts.$inferSelect | null;
  reply: typeof replies.$inferSelect | null;
  annotation: typeof annotations.$inferSelect | null;
  annotationReply: typeof annotationReplies.$inferSelect | null;
}>(row: T, context?: LifecycleQueryContext) {
  const postState = row.post ? contentState(row.post).state : "deleted";
  const replyState = row.reply ? contentState(row.reply).state : "deleted";
  const annotationState = row.annotation ? contentState(row.annotation).state : "deleted";
  const annotationReplyState = row.annotationReply ? contentState(row.annotationReply).state : "deleted";
  const annotationCurrent = row.post
    ? context
      ? contextAnnotationAvailable(context, row.post.id, row.event.annotationId)
      : await currentAnnotationAnchorAvailable(row.post.id, row.event.annotationId)
    : false;
  const postReachable = row.post
    ? buildPostLifecycleView(row.post, context
      ? context.discussionByPostId.get(row.post.id) ?? []
      : await getPostDiscussionStates(row.post.id)).discussionReachable
    : false;
  const annotationEvent = row.event.eventType === "ANNOTATION_CREATED" || row.event.eventType === "ANNOTATION_REPLY_CREATED";
  const annotationTargetState = row.event.eventType === "ANNOTATION_REPLY_CREATED" ? annotationReplyState : annotationState;
  const eventMetadataVisible = annotationEvent
    ? canExposeAnnotationActivitySnapshot(postState, annotationTargetState, annotationCurrent)
    : canExposeActivitySnapshot(postState, row.event.eventType, replyState);
  const docxAttribution = row.notification.notificationType === "DOCX_ATTRIBUTION_NOTICE"
    ? parseDocxAttributionNoticeMetadata(row.notification.metadataJson)
    : null;
  const targetResolution = row.notification.notificationType === "DOCX_ATTRIBUTION_NOTICE"
    ? null
    : resolveNotificationTarget({
      kind: row.notification.notificationType === "POST_REPLY_RECEIVED"
        ? "POST_REPLY"
        : row.notification.notificationType === "POST_ANNOTATION_RECEIVED"
          ? "ANNOTATION"
          : "ANNOTATION_REPLY",
      postExists: Boolean(row.post),
      postReachable,
      targetState: row.notification.notificationType === "POST_REPLY_RECEIVED"
        ? row.reply ? replyState : null
        : row.notification.notificationType === "POST_ANNOTATION_RECEIVED"
          ? row.annotation ? annotationState : null
          : row.annotationReply ? annotationReplyState : null,
      annotationCurrent,
    });
  return {
    ...row,
    docxAttribution: docxAttribution?.postId === row.notification.postId ? docxAttribution : null,
    targetResolution,
    event: { ...row.event, metadataJson: eventMetadataVisible ? row.event.metadataJson : null },
    post: row.post ? { ...row.post, title: postState === "normal" ? row.post.title : "", markdown: "", searchText: "" } : null,
    reply: row.reply ? { ...row.reply, markdown: replyState === "normal" ? row.reply.markdown : "" } : null,
    annotation: row.annotation ? { ...row.annotation, contentMarkdown: annotationState === "normal" && annotationCurrent ? row.annotation.contentMarkdown : "", originalSelectedText: annotationState === "normal" && annotationCurrent ? row.annotation.originalSelectedText : "" } : null,
    annotationReply: row.annotationReply ? { ...row.annotationReply, contentMarkdown: annotationReplyState === "normal" && annotationCurrent ? row.annotationReply.contentMarkdown : "" } : null,
    postAvailable: Boolean(row.post && postState === "normal"),
    postReachable,
    postState,
    replyAvailable: Boolean(row.reply && replyState === "normal"),
    replyState,
    annotationCurrent,
    annotationAvailable: Boolean(row.annotation && annotationState === "normal" && annotationCurrent),
    annotationState,
    annotationReplyAvailable: Boolean(row.annotationReply && annotationReplyState === "normal" && annotationCurrent),
    annotationReplyState,
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
  return getDb()
    .select({
      id: tags.id,
      name: tags.name,
      normalizedName: tags.normalizedName,
      createdAt: tags.createdAt,
      postCount: count(),
    })
    .from(tags)
    .innerJoin(postTags, eq(postTags.tagId, tags.id))
    .innerJoin(posts, eq(postTags.postId, posts.id))
    .where(visiblePost)
    .groupBy(tags.id, tags.name, tags.normalizedName, tags.createdAt)
    .orderBy(asc(tags.name));
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
