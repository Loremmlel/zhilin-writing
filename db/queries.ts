import { alias } from "drizzle-orm/sqlite-core";
import { cacheForRequest } from "vinext/cache";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { getDb } from "./index";
import {
  adminAuditLog,
  activityEvents,
  allowedUsers,
  annotationReplies,
  annotations,
  assets,
  notifications,
  postAnnotationAnchors,
  postAssetRefs,
  postTags,
  posts,
  replies,
  tags,
  users,
} from "./schema";
import { canExposeActivitySnapshot, contentState } from "@/lib/lifecycle/policy";
import { buildPostLifecycleView, buildReplyLifecycleViews } from "@/lib/lifecycle/views";
import { canExposeAnnotationActivitySnapshot } from "@/lib/activity/policy";
import { parseDocxAttributionNoticeMetadata } from "@/lib/notifications/policy";
import { resolveNotificationTarget } from "@/lib/notifications/target-resolution";
import {
  ADMIN_PAGE_SIZE,
  adminDateBounds,
  type AdminContentStatus,
  type AdminListOptions,
  type AdminPageResult,
  type AdminStatusCounts,
} from "@/lib/admin/query";

import { pageBounds } from "@/lib/pagination";

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
  if (postIds.length === 0)
    return { currentAnnotationKeys: new Set(), discussionByPostId: new Map() };
  const db = getDb();
  const [anchorRows, postReplyRows, annotationRows, annotationReplyRows] = await db.batch([
    db
      .select({
        postId: postAnnotationAnchors.postId,
        annotationId: postAnnotationAnchors.annotationId,
      })
      .from(postAnnotationAnchors)
      .where(inArray(postAnnotationAnchors.postId, postIds)),
    db
      .selectDistinct({
        postId: replies.postId,
        authorId: replies.authorId,
        deletedAt: replies.deletedAt,
        hiddenAt: replies.hiddenAt,
      })
      .from(replies)
      .where(inArray(replies.postId, postIds)),
    db
      .selectDistinct({
        postId: postAnnotationAnchors.postId,
        authorId: annotations.authorId,
        deletedAt: annotations.deletedAt,
        hiddenAt: annotations.hiddenAt,
      })
      .from(postAnnotationAnchors)
      .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
      .where(inArray(postAnnotationAnchors.postId, postIds)),
    db
      .selectDistinct({
        postId: postAnnotationAnchors.postId,
        authorId: annotationReplies.authorId,
        deletedAt: annotationReplies.deletedAt,
        hiddenAt: annotationReplies.hiddenAt,
      })
      .from(postAnnotationAnchors)
      .innerJoin(
        annotationReplies,
        eq(postAnnotationAnchors.annotationId, annotationReplies.annotationId),
      )
      .where(inArray(postAnnotationAnchors.postId, postIds)),
  ]);
  const discussionByPostId = new Map<string, DiscussionState[]>();
  for (const row of [...postReplyRows, ...annotationRows, ...annotationReplyRows]) {
    const current = discussionByPostId.get(row.postId) ?? [];
    current.push({ authorId: row.authorId, deletedAt: row.deletedAt, hiddenAt: row.hiddenAt });
    discussionByPostId.set(row.postId, current);
  }
  return {
    currentAnnotationKeys: new Set(
      anchorRows.map((row) => annotationKey(row.postId, row.annotationId)),
    ),
    discussionByPostId,
  };
}

function contextAnnotationAvailable(
  context: LifecycleQueryContext,
  postId: string,
  annotationId: string | null,
): boolean {
  return Boolean(
    annotationId && context.currentAnnotationKeys.has(annotationKey(postId, annotationId)),
  );
}

async function findUsersByIds(idValues: string[]) {
  const ids = [...new Set(idValues)];
  const chunks = Array.from({ length: Math.ceil(ids.length / 90) }, (_, index) =>
    ids.slice(index * 90, index * 90 + 90),
  );
  return (
    await Promise.all(
      chunks.map((chunk) => getDb().select().from(users).where(inArray(users.id, chunk))),
    )
  ).flat();
}

export async function allowlistCount(): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(allowedUsers);
  return row?.value ?? 0;
}

export async function findAllowedUser(email: string) {
  return (
    (await getDb().select().from(allowedUsers).where(eq(allowedUsers.email, email)).limit(1))[0] ??
    null
  );
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
  // Normal access is read-only. Repair bootstrap/owner changes only when needed.
  const configured = await db
    .select()
    .from(allowedUsers)
    .where(
      or(
        eq(allowedUsers.email, email),
        isNull(allowedUsers.addedByUserId),
        eq(allowedUsers.isAdmin, true),
      ),
    );
  if (configured.length === 1 && configured[0].email === email && configured[0].isAdmin)
    return configured[0];

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
    db.update(allowedUsers).set({ isAdmin: false }).where(ne(allowedUsers.email, email)),
  ]);

  return findAllowedUser(email);
}

export async function removeAllowedUser(id: string) {
  await getDb()
    .delete(allowedUsers)
    .where(and(eq(allowedUsers.id, id), eq(allowedUsers.isAdmin, false)));
}

export async function listAllowedUsers() {
  return getDb()
    .select()
    .from(allowedUsers)
    .orderBy(desc(allowedUsers.isAdmin), asc(allowedUsers.email));
}

export async function findUserByEmail(emailKey: string) {
  return (
    (await getDb().select().from(users).where(eq(users.emailKey, emailKey)).limit(1))[0] ?? null
  );
}

export async function findUserById(id: string) {
  return (await getDb().select().from(users).where(eq(users.id, id)).limit(1))[0] ?? null;
}

export async function listUsers() {
  return getDb().select().from(users).orderBy(asc(users.joinedAt));
}

export async function listRecentUsers(limit = 5) {
  return getDb().select().from(users).orderBy(desc(users.joinedAt), desc(users.id)).limit(limit);
}

export async function isDisplayNameTaken(displayName: string, exceptUserId?: string) {
  const row = (
    await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.displayName, displayName))
      .limit(1)
  )[0];
  return Boolean(row && row.id !== exceptUserId);
}

export async function createUserProfile(input: {
  emailKey: string;
  displayName: string;
  bio: string;
}) {
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

export async function updateUserProfile(
  id: string,
  input: { displayName: string; bio: string; avatarAssetId?: string | null },
) {
  await getDb()
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(users.id, id));
  return findUserById(id);
}

export async function updateUserProfileWithAvatar(
  id: string,
  input: { displayName: string; bio: string },
  avatarAssetId: string,
) {
  const db = getDb();
  const now = new Date();
  await db.batch([
    db
      .update(assets)
      .set({
        status: sql<"permanent">`CASE WHEN ${assets.ownerId} = ${id} AND ${assets.status} = 'temporary' AND ${assets.kind} = 'avatar' AND ${assets.deletedAt} IS NULL AND ${assets.gcClaimedAt} IS NULL THEN 'permanent' ELSE NULL END`,
        boundAt: now,
        expiresAt: null,
      })
      .where(eq(assets.id, avatarAssetId)),
    db
      .update(users)
      .set({ ...input, avatarAssetId, updatedAt: now })
      .where(eq(users.id, id)),
  ]);
  return findUserById(id);
}

export async function listPostsPage(
  options: {
    sort?: PostSort;
    query?: string;
    authorId?: string;
    tagName?: string;
    page?: number;
  } = {},
) {
  const conditions = [isNull(posts.deletedAt), isNull(posts.hiddenAt)];
  if (options.authorId) conditions.push(eq(posts.authorId, options.authorId));
  if (options.query?.trim()) {
    const pattern = `%${options.query.trim()}%`;
    conditions.push(or(like(posts.title, pattern), like(posts.searchText, pattern))!);
  }

  if (options.tagName) {
    conditions.push(
      inArray(
        posts.id,
        getDb()
          .select({ postId: postTags.postId })
          .from(postTags)
          .innerJoin(tags, eq(postTags.tagId, tags.id))
          .where(eq(tags.normalizedName, options.tagName.toLocaleLowerCase("zh-CN"))),
      ),
    );
  }

  const [countRow] = await getDb()
    .select({ value: count() })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(...conditions));
  const bounds = pageBounds(countRow?.value ?? 0, options.page);
  const rows = await getDb()
    .select({
      post: {
        id: posts.id,
        title: posts.title,
        publishedAt: posts.publishedAt,
        lastActivityAt: posts.lastActivityAt,
        editedAt: posts.editedAt,
        // searchText is whitespace-normalized by markdownToPlainText. Preserve legacy fallback.
        searchText: sql<string>`case when ${posts.searchText} != '' then substr(${posts.searchText}, 1, 152) else ${posts.markdown} end`,
        markdown: sql<string>`''`,
      },
      author: users,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(...conditions))
    .orderBy(
      options.sort === "active" ? desc(posts.lastActivityAt) : desc(posts.publishedAt),
      desc(posts.id),
    )
    .limit(bounds.pageSize)
    .offset(bounds.offset);
  const ids = rows.map((row) => row.post.id);
  if (ids.length === 0) return { ...bounds, items: [] };
  const [tagRows, replyCountRows, annotationCountRows] = await getDb().batch([
    getDb()
      .select({
        postId: postTags.postId,
        id: tags.id,
        name: tags.name,
        normalizedName: tags.normalizedName,
      })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(inArray(postTags.postId, ids))
      .orderBy(asc(tags.name)),
    getDb()
      .select({ postId: replies.postId, value: count() })
      .from(replies)
      .where(and(inArray(replies.postId, ids), isNull(replies.deletedAt), isNull(replies.hiddenAt)))
      .groupBy(replies.postId),
    getDb()
      .select({ postId: postAnnotationAnchors.postId, value: count() })
      .from(postAnnotationAnchors)
      .where(inArray(postAnnotationAnchors.postId, ids))
      .groupBy(postAnnotationAnchors.postId),
  ]);
  const tagsByPostId = new Map<
    string,
    Array<{ id: string; name: string; normalizedName: string }>
  >();
  for (const tag of tagRows)
    tagsByPostId.set(tag.postId, [
      ...(tagsByPostId.get(tag.postId) ?? []),
      { id: tag.id, name: tag.name, normalizedName: tag.normalizedName },
    ]);
  const replyCountByPostId = new Map(replyCountRows.map((row) => [row.postId, row.value]));
  const annotationCountByPostId = new Map(
    annotationCountRows.map((row) => [row.postId, row.value]),
  );
  const items = rows.map((row) => ({
    ...row,
    tags: tagsByPostId.get(row.post.id) ?? [],
    replyCount: replyCountByPostId.get(row.post.id) ?? 0,
    annotationCount: annotationCountByPostId.get(row.post.id) ?? 0,
  }));
  return { ...bounds, items };
}

export async function getVisiblePostRecord(id: string) {
  return (
    (
      await getDb()
        .select()
        .from(posts)
        .where(and(eq(posts.id, id), visiblePost))
        .limit(1)
    )[0] ?? null
  );
}

export async function getPost(id: string) {
  const row = (
    await getDb()
      .select({ post: posts, author: users })
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .where(and(eq(posts.id, id), visiblePost))
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    ...row,
    tags: await getTagsForPost(id),
    attachments: await getDb()
      .select({ asset: assets })
      .from(postAssetRefs)
      .innerJoin(assets, eq(postAssetRefs.assetId, assets.id))
      .where(
        and(
          eq(postAssetRefs.postId, id),
          eq(postAssetRefs.usage, "attachment"),
          isNull(assets.deletedAt),
        ),
      )
      .then((rows) => rows.map((row) => row.asset)),
  };
}

async function getPostAttachments(id: string) {
  return getDb()
    .select({ asset: assets })
    .from(postAssetRefs)
    .innerJoin(assets, eq(postAssetRefs.assetId, assets.id))
    .where(
      and(
        eq(postAssetRefs.postId, id),
        eq(postAssetRefs.usage, "attachment"),
        isNull(assets.deletedAt),
      ),
    )
    .then((rows) => rows.map((row) => row.asset));
}

// Page-only reads: mutations must not prime this cache before changing a post.
const postReadCache = cacheForRequest(
  () => new Map<string, Promise<Awaited<ReturnType<typeof readPostRow>>>>(),
);
async function readPostRow(id: string) {
  return (
    (
      await getDb()
        .select({ post: posts, author: users })
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .where(eq(posts.id, id))
        .limit(1)
    )[0] ?? null
  );
}
export function getPostReadRow(id: string) {
  const cache = postReadCache();
  if (!cache.has(id)) cache.set(id, readPostRow(id));
  return cache.get(id)!;
}

export async function getPostDetail(id: string) {
  const row = await getPostReadRow(id);
  if (!row) return null;
  const visible = !row.post.deletedAt && !row.post.hiddenAt;
  const [replyStates, tags, attachments] = await Promise.all([
    getPostDiscussionStates(id),
    visible ? getTagsForPost(id) : Promise.resolve([]),
    visible ? getPostAttachments(id) : Promise.resolve([]),
  ]);
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
    tags,
    attachments,
  };
}

async function getPostDiscussionStates(postId: string) {
  const [postReplies, annotationRoots, annotationThreadReplies] = await getDb().batch([
    getDb()
      .select({
        authorId: replies.authorId,
        deletedAt: replies.deletedAt,
        hiddenAt: replies.hiddenAt,
      })
      .from(replies)
      .where(eq(replies.postId, postId)),
    getDb()
      .select({
        authorId: annotations.authorId,
        deletedAt: annotations.deletedAt,
        hiddenAt: annotations.hiddenAt,
      })
      .from(postAnnotationAnchors)
      .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
      .where(eq(postAnnotationAnchors.postId, postId)),
    getDb()
      .select({
        authorId: annotationReplies.authorId,
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
  return [...postReplies, ...annotationRoots, ...annotationThreadReplies];
}

async function currentAnnotationAnchorAvailable(postId: string, annotationId: string | null) {
  if (!annotationId) return false;
  return Boolean(
    (
      await getDb()
        .select({ annotationId: postAnnotationAnchors.annotationId })
        .from(postAnnotationAnchors)
        .where(
          and(
            eq(postAnnotationAnchors.postId, postId),
            eq(postAnnotationAnchors.annotationId, annotationId),
          ),
        )
        .limit(1)
    )[0],
  );
}

export async function getPostForAdministration(id: string) {
  const row = (
    await getDb()
      .select({ post: posts, author: users })
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.id, id))
      .limit(1)
  )[0];
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
  const [row] = await getDb()
    .select({ value: count() })
    .from(replies)
    .where(and(eq(replies.postId, postId), isNull(replies.deletedAt), isNull(replies.hiddenAt)));
  return row?.value ?? 0;
}

export async function listReplies(
  postId: string,
  options: { includeUnavailableReplyId?: string } = {},
) {
  const targetUser = alias(users, "reply_target_user");
  const rows = await getDb()
    .select({
      reply: replies,
      author: users,
      targetUser: {
        id: targetUser.id,
        displayName: targetUser.displayName,
        avatarAssetId: targetUser.avatarAssetId,
      },
    })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .leftJoin(targetUser, eq(replies.replyToUserId, targetUser.id))
    .where(eq(replies.postId, postId))
    .orderBy(asc(replies.publishedAt));
  const lifecycleRows = buildReplyLifecycleViews(
    rows.map((row) => row.reply),
    {
      requiredPlaceholderIds: options.includeUnavailableReplyId
        ? [options.includeUnavailableReplyId]
        : [],
    },
  );
  const included = new Set(lifecycleRows.map((row) => row.id));
  const lifecycleById = new Map(lifecycleRows.map((row) => [row.id, row]));
  const replyById = new Map(rows.map((row) => [row.reply.id, row.reply]));
  return rows
    .filter((row) => included.has(row.reply.id))
    .map((row) => {
      const lifecycle = lifecycleById.get(row.reply.id)!;
      const directTarget = row.reply.replyToReplyId
        ? replyById.get(row.reply.replyToReplyId)
        : null;
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
        replyTo: row.reply.replyToUserId ? row.targetUser : null,
        replyToUnavailable: Boolean(directTarget && contentState(directTarget).state !== "normal"),
      };
    });
}

export async function findReply(id: string) {
  return (await getDb().select().from(replies).where(eq(replies.id, id)).limit(1))[0] ?? null;
}

export async function findReplyBySubmissionKey(authorId: string, submissionKey: string) {
  return (
    (
      await getDb()
        .select()
        .from(replies)
        .where(and(eq(replies.authorId, authorId), eq(replies.submissionKey, submissionKey)))
        .limit(1)
    )[0] ?? null
  );
}

export async function findPostByCreationSubmissionKey(authorId: string, submissionKey: string) {
  return (
    (
      await getDb()
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.authorId, authorId), eq(posts.creationSubmissionKey, submissionKey)))
        .limit(1)
    )[0] ?? null
  );
}

export async function listUserActivityPage(actorUserId: string, page?: number) {
  const conditions = and(
    eq(activityEvents.actorUserId, actorUserId),
    isNull(activityEvents.invalidatedAt),
  );
  const [countRow] = await getDb()
    .select({ value: count() })
    .from(activityEvents)
    .innerJoin(users, eq(activityEvents.actorUserId, users.id))
    .where(conditions);
  const bounds = pageBounds(countRow?.value ?? 0, page);
  const rows = await getDb()
    .select({
      event: activityEvents,
      actor: { id: users.id, displayName: users.displayName },
      post: {
        id: posts.id,
        authorId: posts.authorId,
        title: posts.title,
        deletedAt: posts.deletedAt,
        hiddenAt: posts.hiddenAt,
      },
      reply: {
        id: replies.id,
        markdown: replies.markdown,
        deletedAt: replies.deletedAt,
        hiddenAt: replies.hiddenAt,
      },
      annotation: {
        id: annotations.id,
        contentMarkdown: annotations.contentMarkdown,
        originalSelectedText: annotations.originalSelectedText,
        deletedAt: annotations.deletedAt,
        hiddenAt: annotations.hiddenAt,
      },
      annotationReply: {
        id: annotationReplies.id,
        contentMarkdown: annotationReplies.contentMarkdown,
        deletedAt: annotationReplies.deletedAt,
        hiddenAt: annotationReplies.hiddenAt,
      },
    })
    .from(activityEvents)
    .innerJoin(users, eq(activityEvents.actorUserId, users.id))
    .leftJoin(posts, eq(activityEvents.postId, posts.id))
    .leftJoin(replies, eq(activityEvents.replyId, replies.id))
    .leftJoin(annotations, eq(activityEvents.annotationId, annotations.id))
    .leftJoin(annotationReplies, eq(activityEvents.annotationReplyId, annotationReplies.id))
    .where(conditions)
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(bounds.pageSize)
    .offset(bounds.offset);
  const replyToIds = rows
    .map((row) => row.event.replyToUserId)
    .filter((id): id is string => Boolean(id));
  const [context, replyToUsers] = await Promise.all([
    loadLifecycleQueryContext(rows.flatMap((row) => (row.post ? [row.post.id] : []))),
    findUsersByIds(replyToIds),
  ]);
  const replyToById = new Map(replyToUsers.map((user) => [user.id, user]));
  const items = rows.map((row) => {
    const postState = row.post ? contentState(row.post).state : "deleted";
    const replyState = row.reply ? contentState(row.reply).state : "deleted";
    const annotationState = row.annotation ? contentState(row.annotation).state : "deleted";
    const annotationReplyState = row.annotationReply
      ? contentState(row.annotationReply).state
      : "deleted";
    const annotationCurrent = row.post
      ? contextAnnotationAvailable(context, row.post.id, row.event.annotationId)
      : false;
    const postReachable = row.post
      ? buildPostLifecycleView(row.post, context.discussionByPostId.get(row.post.id) ?? [])
          .discussionReachable
      : false;
    const annotationEvent =
      row.event.eventType === "ANNOTATION_CREATED" ||
      row.event.eventType === "ANNOTATION_REPLY_CREATED";
    const annotationTargetState =
      row.event.eventType === "ANNOTATION_REPLY_CREATED" ? annotationReplyState : annotationState;
    const eventMetadataVisible = annotationEvent
      ? canExposeAnnotationActivitySnapshot(postState, annotationTargetState, annotationCurrent)
      : canExposeActivitySnapshot(postState, row.event.eventType, replyState);
    return {
      ...row,
      event: { ...row.event, metadataJson: eventMetadataVisible ? row.event.metadataJson : null },
      post: row.post
        ? {
            ...row.post,
            title: postState === "normal" ? row.post.title : "",
            markdown: "",
            searchText: "",
          }
        : null,
      reply: row.reply
        ? { ...row.reply, markdown: replyState === "normal" ? row.reply.markdown : "" }
        : null,
      annotation: row.annotation
        ? {
            ...row.annotation,
            contentMarkdown:
              annotationState === "normal" && annotationCurrent
                ? row.annotation.contentMarkdown
                : "",
            originalSelectedText:
              annotationState === "normal" && annotationCurrent
                ? row.annotation.originalSelectedText
                : "",
          }
        : null,
      annotationReply: row.annotationReply
        ? {
            ...row.annotationReply,
            contentMarkdown:
              annotationReplyState === "normal" && annotationCurrent
                ? row.annotationReply.contentMarkdown
                : "",
          }
        : null,
      replyTo: row.event.replyToUserId ? (replyToById.get(row.event.replyToUserId) ?? null) : null,
      postAvailable: Boolean(row.post && postState === "normal"),
      postReachable,
      postState,
      replyAvailable: Boolean(row.reply && replyState === "normal"),
      replyState,
      annotationCurrent,
      annotationAvailable: Boolean(
        row.annotation && annotationState === "normal" && annotationCurrent,
      ),
      annotationState,
      annotationReplyAvailable: Boolean(
        row.annotationReply && annotationReplyState === "normal" && annotationCurrent,
      ),
      annotationReplyState,
    };
  });
  return { ...bounds, items };
}

export async function countUnreadNotifications(recipientUserId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

const notificationSelection = {
  notification: {
    id: notifications.id,
    notificationType: notifications.notificationType,
    postId: notifications.postId,
    replyId: notifications.replyId,
    annotationId: notifications.annotationId,
    annotationReplyId: notifications.annotationReplyId,
    metadataJson: notifications.metadataJson,
    createdAt: notifications.createdAt,
    readAt: notifications.readAt,
  },
  event: {
    eventType: activityEvents.eventType,
    annotationId: activityEvents.annotationId,
    replyToUserId: activityEvents.replyToUserId,
    metadataJson: activityEvents.metadataJson,
  },
  actor: {
    displayName: users.displayName,
    avatarAssetId: users.avatarAssetId,
  },
  post: {
    id: posts.id,
    authorId: posts.authorId,
    title: posts.title,
    deletedAt: posts.deletedAt,
    hiddenAt: posts.hiddenAt,
  },
  reply: {
    markdown: replies.markdown,
    deletedAt: replies.deletedAt,
    hiddenAt: replies.hiddenAt,
  },
  annotation: {
    contentMarkdown: annotations.contentMarkdown,
    originalSelectedText: annotations.originalSelectedText,
    deletedAt: annotations.deletedAt,
    hiddenAt: annotations.hiddenAt,
  },
  annotationReply: {
    contentMarkdown: annotationReplies.contentMarkdown,
    deletedAt: annotationReplies.deletedAt,
    hiddenAt: annotationReplies.hiddenAt,
  },
};

export async function listNotificationsPage(
  recipientUserId: string,
  options: { unreadOnly?: boolean; page?: number } = {},
) {
  const conditions = [eq(notifications.recipientUserId, recipientUserId)];
  if (options.unreadOnly) conditions.push(isNull(notifications.readAt));
  const [countRow] = await getDb()
    .select({ value: count() })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.eventId, activityEvents.id))
    .innerJoin(users, eq(notifications.actorUserId, users.id))
    .where(and(...conditions));
  const bounds = pageBounds(countRow?.value ?? 0, options.page);
  const rows = await getDb()
    .select(notificationSelection)
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.eventId, activityEvents.id))
    .innerJoin(users, eq(notifications.actorUserId, users.id))
    .leftJoin(posts, eq(notifications.postId, posts.id))
    .leftJoin(replies, eq(notifications.replyId, replies.id))
    .leftJoin(annotations, eq(notifications.annotationId, annotations.id))
    .leftJoin(annotationReplies, eq(notifications.annotationReplyId, annotationReplies.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(bounds.pageSize)
    .offset(bounds.offset);
  const context = await loadLifecycleQueryContext(
    rows.flatMap((row) => (row.post ? [row.post.id] : [])),
  );
  return {
    ...bounds,
    items: await Promise.all(rows.map((row) => lifecycleNotificationRow(row, context))),
  };
}

export async function findOwnedNotification(id: string, recipientUserId: string) {
  const row = (
    await getDb()
      .select(notificationSelection)
      .from(notifications)
      .innerJoin(activityEvents, eq(notifications.eventId, activityEvents.id))
      .innerJoin(users, eq(notifications.actorUserId, users.id))
      .leftJoin(posts, eq(notifications.postId, posts.id))
      .leftJoin(replies, eq(notifications.replyId, replies.id))
      .leftJoin(annotations, eq(notifications.annotationId, annotations.id))
      .leftJoin(annotationReplies, eq(notifications.annotationReplyId, annotationReplies.id))
      .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, recipientUserId)))
      .limit(1)
  )[0];
  if (!row) return null;
  return lifecycleNotificationRow(row);
}

async function lifecycleNotificationRow<
  T extends {
    notification: Pick<
      typeof notifications.$inferSelect,
      | "notificationType"
      | "postId"
      | "metadataJson"
      | "replyId"
      | "annotationId"
      | "annotationReplyId"
    >;
    event: Pick<
      typeof activityEvents.$inferSelect,
      "eventType" | "annotationId" | "replyToUserId" | "metadataJson"
    >;
    post: Pick<
      typeof posts.$inferSelect,
      "id" | "authorId" | "title" | "deletedAt" | "hiddenAt"
    > | null;
    reply: Pick<typeof replies.$inferSelect, "markdown" | "deletedAt" | "hiddenAt"> | null;
    annotation: Pick<
      typeof annotations.$inferSelect,
      "contentMarkdown" | "originalSelectedText" | "deletedAt" | "hiddenAt"
    > | null;
    annotationReply: Pick<
      typeof annotationReplies.$inferSelect,
      "contentMarkdown" | "deletedAt" | "hiddenAt"
    > | null;
  },
>(row: T, context?: LifecycleQueryContext) {
  const postState = row.post ? contentState(row.post).state : "deleted";
  const replyState = row.reply ? contentState(row.reply).state : "deleted";
  const annotationState = row.annotation ? contentState(row.annotation).state : "deleted";
  const annotationReplyState = row.annotationReply
    ? contentState(row.annotationReply).state
    : "deleted";
  const annotationCurrent = row.post
    ? context
      ? contextAnnotationAvailable(context, row.post.id, row.event.annotationId)
      : await currentAnnotationAnchorAvailable(row.post.id, row.event.annotationId)
    : false;
  const postReachable = row.post
    ? buildPostLifecycleView(
        row.post,
        context
          ? (context.discussionByPostId.get(row.post.id) ?? [])
          : await getPostDiscussionStates(row.post.id),
      ).discussionReachable
    : false;
  const annotationEvent =
    row.event.eventType === "ANNOTATION_CREATED" ||
    row.event.eventType === "ANNOTATION_REPLY_CREATED";
  const annotationTargetState =
    row.event.eventType === "ANNOTATION_REPLY_CREATED" ? annotationReplyState : annotationState;
  const eventMetadataVisible = annotationEvent
    ? canExposeAnnotationActivitySnapshot(postState, annotationTargetState, annotationCurrent)
    : canExposeActivitySnapshot(postState, row.event.eventType, replyState);
  const docxAttribution =
    row.notification.notificationType === "DOCX_ATTRIBUTION_NOTICE"
      ? parseDocxAttributionNoticeMetadata(row.notification.metadataJson)
      : null;
  const targetResolution =
    row.notification.notificationType === "DOCX_ATTRIBUTION_NOTICE"
      ? null
      : resolveNotificationTarget({
          kind:
            row.notification.notificationType === "POST_REPLY_RECEIVED"
              ? "POST_REPLY"
              : row.notification.notificationType === "POST_ANNOTATION_RECEIVED"
                ? "ANNOTATION"
                : "ANNOTATION_REPLY",
          postExists: Boolean(row.post),
          postReachable,
          targetState:
            row.notification.notificationType === "POST_REPLY_RECEIVED"
              ? row.reply
                ? replyState
                : null
              : row.notification.notificationType === "POST_ANNOTATION_RECEIVED"
                ? row.annotation
                  ? annotationState
                  : null
                : row.annotationReply
                  ? annotationReplyState
                  : null,
          annotationCurrent,
        });
  return {
    ...row,
    docxAttribution: docxAttribution?.postId === row.notification.postId ? docxAttribution : null,
    targetResolution,
    event: { ...row.event, metadataJson: eventMetadataVisible ? row.event.metadataJson : null },
    post: row.post
      ? {
          ...row.post,
          title: postState === "normal" ? row.post.title : "",
          markdown: "",
          searchText: "",
        }
      : null,
    reply: row.reply
      ? { ...row.reply, markdown: replyState === "normal" ? row.reply.markdown : "" }
      : null,
    annotation: row.annotation
      ? {
          ...row.annotation,
          contentMarkdown:
            annotationState === "normal" && annotationCurrent ? row.annotation.contentMarkdown : "",
          originalSelectedText:
            annotationState === "normal" && annotationCurrent
              ? row.annotation.originalSelectedText
              : "",
        }
      : null,
    annotationReply: row.annotationReply
      ? {
          ...row.annotationReply,
          contentMarkdown:
            annotationReplyState === "normal" && annotationCurrent
              ? row.annotationReply.contentMarkdown
              : "",
        }
      : null,
    postAvailable: Boolean(row.post && postState === "normal"),
    postReachable,
    postState,
    replyAvailable: Boolean(row.reply && replyState === "normal"),
    replyState,
    annotationCurrent,
    annotationAvailable: Boolean(
      row.annotation && annotationState === "normal" && annotationCurrent,
    ),
    annotationState,
    annotationReplyAvailable: Boolean(
      row.annotationReply && annotationReplyState === "normal" && annotationCurrent,
    ),
    annotationReplyState,
  };
}

export async function markNotificationRead(id: string, recipientUserId: string) {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientUserId, recipientUserId),
        isNull(notifications.readAt),
      ),
    );
}

export async function markAllNotificationsRead(recipientUserId: string) {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)));
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

export type { AdminContentStatus } from "@/lib/admin/query";

function lifecycleStatusCondition(
  status: AdminContentStatus,
  table: typeof posts | typeof replies,
) {
  if (status === "all") return undefined;
  if (status === "deleted") return isNotNull(table.deletedAt);
  if (status === "hidden") return isNotNull(table.hiddenAt);
  return and(isNull(table.deletedAt), isNull(table.hiddenAt));
}

function statusCounts(row?: {
  all: number | null;
  normal: number | null;
  deleted: number | null;
  hidden: number | null;
}): AdminStatusCounts {
  return {
    all: Number(row?.all ?? 0),
    normal: Number(row?.normal ?? 0),
    deleted: Number(row?.deleted ?? 0),
    hidden: Number(row?.hidden ?? 0),
  };
}

export async function countAdminOverviewByStatus(): Promise<AdminStatusCounts[]> {
  const tables = [posts, replies, annotations, annotationReplies] as const;
  const statements = tables.map((table) =>
    getDb()
      .select({
        all: count(),
        normal: sql<number>`sum(case when ${table.deletedAt} is null and ${table.hiddenAt} is null then 1 else 0 end)`,
        deleted: sql<number>`sum(case when ${table.deletedAt} is not null then 1 else 0 end)`,
        hidden: sql<number>`sum(case when ${table.hiddenAt} is not null then 1 else 0 end)`,
      })
      .from(table),
  );
  const results = await getDb().batch([
    statements[0]!,
    statements[1]!,
    statements[2]!,
    statements[3]!,
  ]);
  return results.map(([row]) => statusCounts(row));
}

export async function listAdminPosts(
  options: AdminListOptions,
): Promise<AdminPageResult<Awaited<ReturnType<typeof selectAdminPostRows>>[number]>> {
  const db = getDb();
  const search = options.q ? `%${options.q}%` : null;
  const { start, endExclusive } = adminDateBounds(options);
  const condition = and(
    lifecycleStatusCondition(options.status, posts),
    search ? or(like(posts.searchText, search), like(users.displayName, search)) : undefined,
    start ? gte(posts.publishedAt, start) : undefined,
    endExclusive ? lt(posts.publishedAt, endExclusive) : undefined,
  );
  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(condition);
  const pageSize = Math.min(Math.max(options.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
  const page = Math.min(options.page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await selectAdminPostRows(condition, options.sort, page, pageSize);
  return { rows, total, page, pageSize };
}

function selectAdminPostRows(
  condition: ReturnType<typeof lifecycleStatusCondition>,
  sort: AdminListOptions["sort"],
  page: number,
  pageSize: number,
) {
  return getDb()
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(condition)
    .orderBy(
      sort === "oldest" ? asc(posts.publishedAt) : desc(posts.publishedAt),
      sort === "oldest" ? asc(posts.id) : desc(posts.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

export async function listAdminReplies(
  options: AdminListOptions,
): Promise<AdminPageResult<Awaited<ReturnType<typeof selectAdminReplyRows>>[number]>> {
  const db = getDb();
  const search = options.q ? `%${options.q}%` : null;
  const { start, endExclusive } = adminDateBounds(options);
  const condition = and(
    lifecycleStatusCondition(options.status, replies),
    search
      ? or(
          like(replies.markdown, search),
          like(posts.title, search),
          like(users.displayName, search),
        )
      : undefined,
    start ? gte(replies.publishedAt, start) : undefined,
    endExclusive ? lt(replies.publishedAt, endExclusive) : undefined,
  );
  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .innerJoin(posts, eq(replies.postId, posts.id))
    .where(condition);
  const pageSize = Math.min(Math.max(options.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
  const page = Math.min(options.page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await selectAdminReplyRows(condition, options.sort, page, pageSize);
  return { rows, total, page, pageSize };
}

function selectAdminReplyRows(
  condition: ReturnType<typeof lifecycleStatusCondition>,
  sort: AdminListOptions["sort"],
  page: number,
  pageSize: number,
) {
  return getDb()
    .select({ reply: replies, author: users, post: posts })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .innerJoin(posts, eq(replies.postId, posts.id))
    .where(condition)
    .orderBy(
      sort === "oldest" ? asc(replies.publishedAt) : desc(replies.publishedAt),
      sort === "oldest" ? asc(replies.id) : desc(replies.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

export async function listAdminAuditLog(limit = 60) {
  return getDb()
    .select({ audit: adminAuditLog, administrator: users })
    .from(adminAuditLog)
    .innerJoin(users, eq(adminAuditLog.adminUserId, users.id))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit);
}

export async function listAdminAuditLogPage(page: number, pageSize = ADMIN_PAGE_SIZE) {
  const [{ value: total = 0 } = { value: 0 }] = await getDb()
    .select({ value: count() })
    .from(adminAuditLog);
  const safePageSize = Math.min(Math.max(pageSize, 1), 100);
  const safePage = Math.min(page, Math.max(1, Math.ceil(total / safePageSize)));
  const rows = await getDb()
    .select({ audit: adminAuditLog, administrator: users })
    .from(adminAuditLog)
    .innerJoin(users, eq(adminAuditLog.adminUserId, users.id))
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(safePageSize)
    .offset((safePage - 1) * safePageSize);
  return { rows, total, page: safePage, pageSize: safePageSize };
}

export async function findAsset(id: string) {
  return (
    (
      await getDb()
        .select()
        .from(assets)
        .where(and(eq(assets.id, id), isNull(assets.deletedAt)))
        .limit(1)
    )[0] ?? null
  );
}

export async function listAssetsForOwner(ownerId: string, status?: "temporary" | "permanent") {
  const conditions = [eq(assets.ownerId, ownerId), isNull(assets.deletedAt)];
  if (status) conditions.push(eq(assets.status, status));
  return getDb()
    .select()
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt));
}
