import { and, asc, count, desc, eq, gte, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import { alias, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { getDb } from "@/db";
import { getPostReadRow } from "@/db/queries";
import { annotationReplies, annotations, postAnnotationAnchors, posts, users } from "@/db/schema";
import { contentState } from "@/lib/lifecycle/policy";
import {
  ADMIN_PAGE_SIZE,
  adminDateBounds,
  type AdminContentStatus,
  type AdminListOptions,
  type AdminPageResult,
} from "@/lib/admin/query";
import { buildAnnotationAuthorView } from "./identity";
import { buildAnnotationReplyLifecycleViews } from "./lifecycle";
import { sortAnnotationReplyRows, sortAnnotationRowsByAnchorPosition } from "./policy";

const annotationAuthor = alias(users, "annotation_author");
const annotationAttributedUser = alias(users, "annotation_attributed_user");
const replyAuthor = alias(users, "annotation_reply_author");
const replyAttributedUser = alias(users, "annotation_reply_attributed_user");
const replyTargetUser = alias(users, "annotation_reply_target_user");

// D1 batch rows are keyed by SQL column name; each joined user needs unique aliases.
function batchUserView(
  user: { id: AnySQLiteColumn; displayName: AnySQLiteColumn; avatarAssetId: AnySQLiteColumn },
  prefix: string,
) {
  return {
    id: sql<string>`${user.id}`.as(`${prefix}_id`),
    displayName: sql<string>`${user.displayName}`.as(`${prefix}_display_name`),
    avatarAssetId: sql<string | null>`${user.avatarAssetId}`.as(`${prefix}_avatar_asset_id`),
  };
}

export async function findAnnotation(id: string) {
  return (
    (await getDb().select().from(annotations).where(eq(annotations.id, id)).limit(1))[0] ?? null
  );
}

export async function findAnnotationBySubmissionKey(authorId: string, submissionKey: string) {
  return (
    (
      await getDb()
        .select()
        .from(annotations)
        .where(
          and(eq(annotations.authorId, authorId), eq(annotations.submissionKey, submissionKey)),
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function findAnnotationReply(id: string) {
  return (
    (
      await getDb().select().from(annotationReplies).where(eq(annotationReplies.id, id)).limit(1)
    )[0] ?? null
  );
}

export async function findAnnotationReplyBySubmissionKey(authorId: string, submissionKey: string) {
  return (
    (
      await getDb()
        .select()
        .from(annotationReplies)
        .where(
          and(
            eq(annotationReplies.authorId, authorId),
            eq(annotationReplies.submissionKey, submissionKey),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

export function getCurrentAnnotationStates(postId: string) {
  return getDb()
    .select({
      annotationId: annotations.id,
      deletedAt: annotations.deletedAt,
      deletedByUserId: annotations.deletedByUserId,
      hiddenAt: annotations.hiddenAt,
      hiddenByUserId: annotations.hiddenByUserId,
    })
    .from(postAnnotationAnchors)
    .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
    .where(eq(postAnnotationAnchors.postId, postId))
    .orderBy(asc(annotations.createdAt), asc(annotations.id));
}

export function getCurrentAnnotationSaveStates(postId: string) {
  return getDb()
    .select({
      annotationId: annotations.id,
      annotationPostId: annotations.postId,
      deletedAt: annotations.deletedAt,
      deletedByUserId: annotations.deletedByUserId,
      hiddenAt: annotations.hiddenAt,
      hiddenByUserId: annotations.hiddenByUserId,
    })
    .from(postAnnotationAnchors)
    .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
    .where(eq(postAnnotationAnchors.postId, postId))
    .orderBy(asc(annotations.id));
}

export async function getCurrentAnnotationAnchorIds(postId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ annotationId: postAnnotationAnchors.annotationId })
    .from(postAnnotationAnchors)
    .where(eq(postAnnotationAnchors.postId, postId))
    .orderBy(asc(postAnnotationAnchors.annotationId));
  return rows.map((row) => row.annotationId);
}

function currentAnnotationRows(postId: string) {
  return getDb()
    .select({
      annotation: annotations,
      nativeAuthor: batchUserView(annotationAuthor, "annotationAuthor"),
      attributedUser: batchUserView(annotationAttributedUser, "annotationAttributedUser"),
    })
    .from(postAnnotationAnchors)
    .innerJoin(annotations, eq(postAnnotationAnchors.annotationId, annotations.id))
    .leftJoin(annotationAuthor, eq(annotations.authorId, annotationAuthor.id))
    .leftJoin(
      annotationAttributedUser,
      eq(annotations.attributedUserId, annotationAttributedUser.id),
    )
    .where(eq(postAnnotationAnchors.postId, postId))
    .orderBy(asc(annotations.createdAt), asc(annotations.id));
}

export async function listCurrentAnnotationThreads(
  postId: string,
  viewerId: string,
  options: { includeUnavailableReplyId?: string } = {},
) {
  const post = await getPostReadRow(postId, viewerId);
  if (!post) return [];
  const [rootRows, rawReplyRows] = await getDb().batch([
    currentAnnotationRows(postId),
    getDb()
      .select({
        reply: annotationReplies,
        nativeAuthor: batchUserView(replyAuthor, "replyAuthor"),
        attributedUser: batchUserView(replyAttributedUser, "replyAttributedUser"),
        targetUser: batchUserView(replyTargetUser, "replyTargetUser"),
      })
      .from(annotationReplies)
      .innerJoin(
        postAnnotationAnchors,
        eq(postAnnotationAnchors.annotationId, annotationReplies.annotationId),
      )
      .leftJoin(replyAuthor, eq(annotationReplies.authorId, replyAuthor.id))
      .leftJoin(replyAttributedUser, eq(annotationReplies.attributedUserId, replyAttributedUser.id))
      .leftJoin(replyTargetUser, eq(annotationReplies.replyToUserId, replyTargetUser.id))
      .where(eq(postAnnotationAnchors.postId, postId))
      .orderBy(asc(annotationReplies.createdAt), asc(annotationReplies.id)),
  ]);
  const roots = sortAnnotationRowsByAnchorPosition(
    post.post.markdown,
    rootRows.map(({ annotation, nativeAuthor, attributedUser }) => ({
      annotation,
      author: buildAnnotationAuthorView(
        annotation,
        nativeAuthor?.id ? nativeAuthor : null,
        attributedUser?.id ? attributedUser : null,
      ),
    })),
  );
  const replyRows = sortAnnotationReplyRows(
    rawReplyRows.map(({ reply, nativeAuthor, attributedUser }) => ({
      reply,
      author: buildAnnotationAuthorView(
        reply,
        nativeAuthor?.id ? nativeAuthor : null,
        attributedUser?.id ? attributedUser : null,
      ),
    })),
  );
  const targetById = new Map(
    rawReplyRows.flatMap(({ targetUser }) =>
      targetUser?.id ? [[targetUser.id, targetUser] as const] : [],
    ),
  );
  const replyById = new Map(replyRows.map((row) => [row.reply.id, row]));
  return roots.map((root) => {
    const rootState = contentState(root.annotation).state;
    const threadRows = replyRows.filter((row) => row.reply.annotationId === root.annotation.id);
    const lifecycle = buildAnnotationReplyLifecycleViews(
      threadRows.map((row) => row.reply),
      {
        requiredPlaceholderIds: options.includeUnavailableReplyId
          ? [options.includeUnavailableReplyId]
          : [],
      },
    );
    const lifecycleById = new Map(lifecycle.map((reply) => [reply.id, reply]));
    return {
      ...root,
      annotation:
        rootState === "normal" ? root.annotation : { ...root.annotation, contentMarkdown: "" },
      lifecycle: {
        state: rootState,
        contentVisible: rootState === "normal",
        placeholder:
          rootState === "hidden"
            ? "该批注已被管理员隐藏。"
            : rootState === "deleted"
              ? "该批注已被作者删除。"
              : null,
      },
      retainsAnchorOnAuthorDelete: threadRows.some(
        (row) => row.reply.authorId !== root.annotation.authorId && !row.reply.deletedAt,
      ),
      replies: threadRows.flatMap((row) => {
        const view = lifecycleById.get(row.reply.id);
        if (!view) return [];
        const replyTarget = row.reply.replyToReplyId
          ? (replyById.get(row.reply.replyToReplyId)?.author ?? null)
          : null;
        const userTarget = row.reply.replyToUserId
          ? (targetById.get(row.reply.replyToUserId) ?? null)
          : null;
        return [
          {
            ...row,
            reply: view.contentVisible ? row.reply : { ...row.reply, contentMarkdown: "" },
            lifecycle: view,
            replyTo: replyTarget ?? userTarget,
          },
        ];
      }),
    };
  });
}

function annotationStatusCondition(status: AdminContentStatus) {
  if (status === "all") return undefined;
  const condition =
    status === "deleted"
      ? isNotNull(annotations.deletedAt)
      : status === "hidden"
        ? isNotNull(annotations.hiddenAt)
        : and(isNull(annotations.deletedAt), isNull(annotations.hiddenAt));
  return condition;
}

function annotationReplyStatusCondition(status: AdminContentStatus) {
  if (status === "all") return undefined;
  return status === "deleted"
    ? isNotNull(annotationReplies.deletedAt)
    : status === "hidden"
      ? isNotNull(annotationReplies.hiddenAt)
      : and(isNull(annotationReplies.deletedAt), isNull(annotationReplies.hiddenAt));
}

export async function listAdminAnnotations(
  options: AdminListOptions,
): Promise<AdminPageResult<Awaited<ReturnType<typeof selectAdminAnnotationRows>>[number]>> {
  const search = options.q ? `%${options.q}%` : null;
  const { start, endExclusive } = adminDateBounds(options);
  const authoredAt = sql<Date>`coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt})`;
  const condition = and(
    annotationStatusCondition(options.status),
    search
      ? or(
          like(annotations.contentMarkdown, search),
          like(annotations.originalSelectedText, search),
          like(posts.title, search),
          like(annotationAuthor.displayName, search),
          like(annotationAttributedUser.displayName, search),
          like(annotations.sourceAuthorName, search),
        )
      : undefined,
    start ? gte(authoredAt, start) : undefined,
    endExclusive ? lt(authoredAt, endExclusive) : undefined,
  );
  const [{ value: total = 0 } = { value: 0 }] = await getDb()
    .select({ value: count() })
    .from(annotations)
    .leftJoin(annotationAuthor, eq(annotations.authorId, annotationAuthor.id))
    .leftJoin(
      annotationAttributedUser,
      eq(annotations.attributedUserId, annotationAttributedUser.id),
    )
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .where(condition);
  const pageSize = Math.min(Math.max(options.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
  const page = Math.min(options.page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await selectAdminAnnotationRows(condition, options.sort, page, pageSize);
  return { rows, total, page, pageSize };
}

function selectAdminAnnotationRows(
  condition: ReturnType<typeof annotationStatusCondition>,
  sort: AdminListOptions["sort"],
  page: number,
  pageSize: number,
) {
  const authoredAt = sql<Date>`coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt})`;
  return getDb()
    .select({
      annotation: annotations,
      nativeAuthor: annotationAuthor,
      attributedUser: annotationAttributedUser,
      post: posts,
      currentAnchorId: postAnnotationAnchors.annotationId,
    })
    .from(annotations)
    .leftJoin(annotationAuthor, eq(annotations.authorId, annotationAuthor.id))
    .leftJoin(
      annotationAttributedUser,
      eq(annotations.attributedUserId, annotationAttributedUser.id),
    )
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .leftJoin(
      postAnnotationAnchors,
      and(
        eq(postAnnotationAnchors.annotationId, annotations.id),
        eq(postAnnotationAnchors.postId, annotations.postId),
      ),
    )
    .where(condition)
    .orderBy(
      sort === "oldest" ? asc(authoredAt) : desc(authoredAt),
      sort === "oldest" ? asc(annotations.id) : desc(annotations.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .then((rows) =>
      rows.map(({ annotation, nativeAuthor, attributedUser, post, currentAnchorId }) => ({
        annotation,
        author: buildAnnotationAuthorView(annotation, nativeAuthor, attributedUser),
        post,
        isCurrent: Boolean(currentAnchorId),
      })),
    );
}

export async function listAdminAnnotationReplies(
  options: AdminListOptions,
): Promise<AdminPageResult<Awaited<ReturnType<typeof selectAdminAnnotationReplyRows>>[number]>> {
  const search = options.q ? `%${options.q}%` : null;
  const { start, endExclusive } = adminDateBounds(options);
  const authoredAt = sql<Date>`coalesce(${annotationReplies.sourceCreatedAt}, ${annotationReplies.createdAt})`;
  const condition = and(
    annotationReplyStatusCondition(options.status),
    search
      ? or(
          like(annotationReplies.contentMarkdown, search),
          like(annotations.originalSelectedText, search),
          like(posts.title, search),
          like(replyAuthor.displayName, search),
          like(replyAttributedUser.displayName, search),
          like(annotationReplies.sourceAuthorName, search),
        )
      : undefined,
    start ? gte(authoredAt, start) : undefined,
    endExclusive ? lt(authoredAt, endExclusive) : undefined,
  );
  const [{ value: total = 0 } = { value: 0 }] = await getDb()
    .select({ value: count() })
    .from(annotationReplies)
    .leftJoin(replyAuthor, eq(annotationReplies.authorId, replyAuthor.id))
    .leftJoin(replyAttributedUser, eq(annotationReplies.attributedUserId, replyAttributedUser.id))
    .innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id))
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .where(condition);
  const pageSize = Math.min(Math.max(options.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
  const page = Math.min(options.page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await selectAdminAnnotationReplyRows(condition, options.sort, page, pageSize);
  return { rows, total, page, pageSize };
}

function selectAdminAnnotationReplyRows(
  condition: ReturnType<typeof annotationReplyStatusCondition>,
  sort: AdminListOptions["sort"],
  page: number,
  pageSize: number,
) {
  const authoredAt = sql<Date>`coalesce(${annotationReplies.sourceCreatedAt}, ${annotationReplies.createdAt})`;
  return getDb()
    .select({
      reply: annotationReplies,
      nativeAuthor: replyAuthor,
      attributedUser: replyAttributedUser,
      annotation: annotations,
      post: posts,
      currentAnchorId: postAnnotationAnchors.annotationId,
    })
    .from(annotationReplies)
    .leftJoin(replyAuthor, eq(annotationReplies.authorId, replyAuthor.id))
    .leftJoin(replyAttributedUser, eq(annotationReplies.attributedUserId, replyAttributedUser.id))
    .innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id))
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .leftJoin(
      postAnnotationAnchors,
      and(
        eq(postAnnotationAnchors.annotationId, annotations.id),
        eq(postAnnotationAnchors.postId, annotations.postId),
      ),
    )
    .where(condition)
    .orderBy(
      sort === "oldest" ? asc(authoredAt) : desc(authoredAt),
      sort === "oldest" ? asc(annotationReplies.id) : desc(annotationReplies.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .then((rows) =>
      rows.map(({ reply, nativeAuthor, attributedUser, annotation, post, currentAnchorId }) => ({
        reply,
        author: buildAnnotationAuthorView(reply, nativeAuthor, attributedUser),
        annotation,
        post,
        isCurrent: Boolean(currentAnchorId),
      })),
    );
}
