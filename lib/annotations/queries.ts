import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getDb } from "@/db";
import { annotationReplies, annotations, postAnnotationAnchors, posts, users } from "@/db/schema";
import { contentState } from "@/lib/lifecycle/policy";
import { buildAnnotationAuthorView } from "./identity";
import { buildAnnotationReplyLifecycleViews } from "./lifecycle";
import { sortAnnotationReplyRows, sortAnnotationRowsByAnchorPosition } from "./policy";

const annotationAuthor = alias(users, "annotation_author");
const annotationAttributedUser = alias(users, "annotation_attributed_user");
const replyAuthor = alias(users, "annotation_reply_author");
const replyAttributedUser = alias(users, "annotation_reply_attributed_user");

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

export async function getCurrentAnnotationStates(postId: string) {
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

export async function getCurrentAnnotationSaveStates(postId: string) {
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

export async function listCurrentAnnotations(postId: string) {
  const rows = await getDb()
    .select({
      annotation: annotations,
      nativeAuthor: annotationAuthor,
      attributedUser: annotationAttributedUser,
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
  return rows.map(({ annotation, nativeAuthor, attributedUser }) => ({
    annotation,
    author: buildAnnotationAuthorView(annotation, nativeAuthor, attributedUser),
  }));
}

export async function listCurrentAnnotationThreads(
  postId: string,
  options: { includeUnavailableReplyId?: string } = {},
) {
  const [rawRoots, post] = await Promise.all([
    listCurrentAnnotations(postId),
    getDb()
      .select({ markdown: posts.markdown })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  if (!post) return [];
  const roots = sortAnnotationRowsByAnchorPosition(post.markdown, rawRoots);
  const ids = roots.map((row) => row.annotation.id);
  if (ids.length === 0) return [];
  const rawReplyRows = await getDb()
    .select({
      reply: annotationReplies,
      nativeAuthor: replyAuthor,
      attributedUser: replyAttributedUser,
    })
    .from(annotationReplies)
    .leftJoin(replyAuthor, eq(annotationReplies.authorId, replyAuthor.id))
    .leftJoin(replyAttributedUser, eq(annotationReplies.attributedUserId, replyAttributedUser.id))
    .where(inArray(annotationReplies.annotationId, ids))
    .orderBy(asc(annotationReplies.createdAt), asc(annotationReplies.id));
  const replyRows = sortAnnotationReplyRows(
    rawReplyRows.map(({ reply, nativeAuthor, attributedUser }) => ({
      reply,
      author: buildAnnotationAuthorView(reply, nativeAuthor, attributedUser),
    })),
  );
  const targetIds = [
    ...new Set(
      replyRows.map((row) => row.reply.replyToUserId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const targetUsers = targetIds.length
    ? await getDb().select().from(users).where(inArray(users.id, targetIds))
    : [];
  const targetById = new Map(targetUsers.map((user) => [user.id, user]));
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

export type AnnotationAdminStatus = "normal" | "deleted" | "hidden";

export async function listAdminAnnotations(status: AnnotationAdminStatus, limit = 100) {
  const condition =
    status === "deleted"
      ? isNotNull(annotations.deletedAt)
      : status === "hidden"
        ? isNotNull(annotations.hiddenAt)
        : and(isNull(annotations.deletedAt), isNull(annotations.hiddenAt));
  const rows = await getDb()
    .select({
      annotation: annotations,
      nativeAuthor: annotationAuthor,
      attributedUser: annotationAttributedUser,
      post: posts,
    })
    .from(annotations)
    .leftJoin(annotationAuthor, eq(annotations.authorId, annotationAuthor.id))
    .leftJoin(
      annotationAttributedUser,
      eq(annotations.attributedUserId, annotationAttributedUser.id),
    )
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .where(condition)
    .orderBy(desc(annotations.createdAt))
    .limit(limit);
  return rows.map(({ annotation, nativeAuthor, attributedUser, post }) => ({
    annotation,
    author: buildAnnotationAuthorView(annotation, nativeAuthor, attributedUser),
    post,
  }));
}

export async function listAdminAnnotationReplies(status: AnnotationAdminStatus, limit = 100) {
  const condition =
    status === "deleted"
      ? isNotNull(annotationReplies.deletedAt)
      : status === "hidden"
        ? isNotNull(annotationReplies.hiddenAt)
        : and(isNull(annotationReplies.deletedAt), isNull(annotationReplies.hiddenAt));
  const rows = await getDb()
    .select({
      reply: annotationReplies,
      nativeAuthor: replyAuthor,
      attributedUser: replyAttributedUser,
      annotation: annotations,
      post: posts,
    })
    .from(annotationReplies)
    .leftJoin(replyAuthor, eq(annotationReplies.authorId, replyAuthor.id))
    .leftJoin(replyAttributedUser, eq(annotationReplies.attributedUserId, replyAttributedUser.id))
    .innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id))
    .innerJoin(posts, eq(annotations.postId, posts.id))
    .where(condition)
    .orderBy(desc(annotationReplies.createdAt))
    .limit(limit);
  return rows.map(({ reply, nativeAuthor, attributedUser, annotation, post }) => ({
    reply,
    author: buildAnnotationAuthorView(reply, nativeAuthor, attributedUser),
    annotation,
    post,
  }));
}
