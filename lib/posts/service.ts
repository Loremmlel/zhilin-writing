import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { inIdList } from "@/db/id-list";
import {
  activityEvents,
  assets,
  notifications,
  postAssetRefs,
  postRevisions,
  posts,
  postTags,
  replies,
  revisionAssetRefs,
  tags,
} from "@/db/schema";
import {
  findPostByCreationSubmissionKey,
  findReply,
  findReplyBySubmissionKey,
  getVisiblePostRecord,
} from "@/db/queries";
import {
  activityEventId,
  notificationId,
  resolveReplyRecipient,
  validateSubmissionKey,
} from "@/lib/activity/policy";
import { assertOrdinaryPostMarkdown } from "@/lib/annotations/policy";
import { getCurrentAnnotationSaveStates } from "@/lib/annotations/queries";
import { AnnotationIntegrityError, planAnnotatedPostSave } from "@/lib/annotations/save-plan";
import { validateCanonicalAnnotationDocument } from "@/lib/annotations/invariants";
import {
  canEditPost,
  normalizeReplyTarget,
  validatePostInput,
  validateReplyMarkdown,
} from "@/lib/domain/rules";
import { markdownToPlainText } from "@/lib/markdown/render";
import {
  buildAssetSnapshot,
  classifyPostChange,
  resolveSaveBase,
  type AssetSnapshotRef,
} from "@/lib/revisions/policy";
import { planContentSave } from "@/lib/revisions/save-plan";
import {
  EditConflictError,
  getConflictSnapshot,
  getCurrentAssetRefs,
  getCurrentImportedReplySaveStates,
} from "@/lib/revisions/service";
import { buildAnnotatedPostSaveOperations, commitPostSave, planPostTags } from "./save-transaction";

import { postVisibilityCondition } from "./visibility";
import { normalizePostVisibility } from "./visibility-service";

type SavePostInput = {
  visibilityUserIds?: string[] | null;
  title: string;
  markdown: string;
  tags: string[];
  attachmentIds?: string[];
  baseRevisionId?: string;
  overwriteBaseRevisionId?: string;
  confirmedAnnotationDeletionIds?: string[];
};

export class PostCreationConflictError extends Error {
  readonly code = "POST_CREATION_CONFLICT";

  constructor() {
    super("这份草稿曾用于发布另一篇帖子，当前内容已保留。请再次点击发布，创建新帖子。");
    this.name = "PostCreationConflictError";
  }
}

async function recoverCreatedPost(
  existing: NonNullable<Awaited<ReturnType<typeof findPostByCreationSubmissionKey>>>,
  input: SavePostInput,
  visibilityUserIds: string[] | null,
  assetRefs: AssetSnapshotRef[],
) {
  const [existingTags, existingAssetRefs] = await getDb().batch([
    getDb()
      .select({ name: tags.normalizedName })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(postTags.postId, existing.id)),
    getCurrentAssetRefs(existing.id),
  ]);
  if (
    existing.deletedAt ||
    existing.hiddenAt ||
    classifyPostChange({ ...existing, assetRefs: existingAssetRefs }, { ...input, assetRefs })
      .contentChanged ||
    JSON.stringify(existingTags.map((tag) => tag.name).sort()) !==
      JSON.stringify(input.tags.map((tag) => tag.toLocaleLowerCase("zh-CN")).sort()) ||
    JSON.stringify(existing.visibilityUserIds) !== JSON.stringify(visibilityUserIds)
  )
    throw new PostCreationConflictError();
  return existing.id;
}

async function buildPostTagOperations(
  postId: string,
  names: string[],
  now: Date,
): Promise<BatchItem<"sqlite">[]> {
  const db = getDb();
  const normalizedNames = names.map((name) => name.toLocaleLowerCase("zh-CN"));
  const existing =
    normalizedNames.length === 0
      ? []
      : await db.select().from(tags).where(inArray(tags.normalizedName, normalizedNames));
  const plan = planPostTags(names, existing, now);
  return [
    ...plan.newTags.map((tag) => db.insert(tags).values(tag).onConflictDoNothing()),
    db.delete(postTags).where(eq(postTags.postId, postId)),
    ...plan.bindings.map(({ tagId }) => db.insert(postTags).values({ postId, tagId })),
  ];
}

function asBatch(items: BatchItem<"sqlite">[]) {
  if (items.length === 0) throw new Error("保存事务不能为空");
  return items as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
}

async function validateSnapshotAssets(authorId: string, refs: AssetSnapshotRef[]) {
  const ids = [...new Set(refs.map((ref) => ref.assetId))];
  if (ids.length === 0) return;
  const rows = await getDb()
    .select({ ownerId: assets.ownerId, gcClaimedAt: assets.gcClaimedAt })
    .from(assets)
    .where(and(inIdList(assets.id, ids), isNull(assets.deletedAt)));
  if (
    rows.length !== ids.length ||
    rows.some((asset) => asset.ownerId !== authorId || asset.gcClaimedAt !== null)
  ) {
    throw new Error("帖子引用了无权使用或不存在的资源");
  }
}

export async function createPost(
  authorId: string,
  input: SavePostInput & { submissionKey: string },
) {
  const clean = validatePostInput(input);
  assertOrdinaryPostMarkdown(clean.markdown);
  const submissionKey = validateSubmissionKey(input.submissionKey);
  const visibilityUserIds = await normalizePostVisibility(
    input.visibilityUserIds ?? null,
    authorId,
  );
  const assetRefs = buildAssetSnapshot(clean.markdown, input.attachmentIds ?? []);
  const duplicate = await findPostByCreationSubmissionKey(authorId, submissionKey);
  if (duplicate) return recoverCreatedPost(duplicate, clean, visibilityUserIds, assetRefs);
  const now = new Date();
  const id = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  await validateSnapshotAssets(authorId, assetRefs);
  const db = getDb();
  const tagOperations = await buildPostTagOperations(id, clean.tags, now);
  const contentOperations: BatchItem<"sqlite">[] = [
    db.insert(posts).values({
      id,
      authorId,
      creationSubmissionKey: submissionKey,
      visibilityUserIds,
      title: clean.title,
      markdown: clean.markdown,
      searchText: markdownToPlainText(clean.markdown),
      currentRevisionId: revisionId,
      publishedAt: now,
      editedAt: null,
      lastActivityAt: now,
      deletedAt: null,
      deletedByUserId: null,
      hiddenAt: null,
      hiddenByUserId: null,
      hiddenReason: null,
    }),
    db.insert(postRevisions).values({
      id: revisionId,
      postId: id,
      revisionNumber: 1,
      kind: "CONTENT_EDIT",
      title: clean.title,
      markdown: clean.markdown,
      createdAt: now,
      createdByUserId: authorId,
      restoreSourceRevisionId: null,
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
  ];
  const assetOperations: BatchItem<"sqlite">[] = [
    ...assetRefs.map((ref) => db.insert(postAssetRefs).values({ postId: id, ...ref })),
    ...assetRefs.map((ref) => db.insert(revisionAssetRefs).values({ revisionId, ...ref })),
    ...assetRefs.map((ref) =>
      db
        .update(assets)
        .set({
          postId: id,
          status: sql<"permanent">`CASE WHEN ${assets.gcClaimedAt} IS NULL AND ${assets.deletedAt} IS NULL THEN 'permanent' ELSE NULL END`,
          boundAt: now,
          expiresAt: null,
        })
        .where(and(eq(assets.id, ref.assetId), eq(assets.ownerId, authorId))),
    ),
  ];
  try {
    await commitPostSave((items) => db.batch(asBatch(items)), {
      content: contentOperations,
      assets: assetOperations,
      tags: tagOperations,
    });
  } catch (error) {
    const repeated = await findPostByCreationSubmissionKey(authorId, submissionKey);
    if (repeated) return recoverCreatedPost(repeated, clean, visibilityUserIds, assetRefs);
    throw error;
  }
  return id;
}

export async function updatePost(postId: string, currentUserId: string, input: SavePostInput) {
  const existing = await getVisiblePostRecord(postId);
  if (!existing) throw new Error("帖子不存在");
  if (!canEditPost(existing.authorId, currentUserId)) throw new Error("你不能编辑这篇帖子");
  if (!existing.currentRevisionId) throw new Error("帖子当前版本不存在");
  if (!input.baseRevisionId) throw new Error("缺少编辑基础版本，请刷新后重试");
  const base = resolveSaveBase(
    existing.currentRevisionId,
    input.baseRevisionId,
    input.overwriteBaseRevisionId,
  );
  if (!base.ok)
    throw new EditConflictError(
      await getConflictSnapshot(postId, base.currentRevisionId, input.baseRevisionId),
    );
  if (input.overwriteBaseRevisionId) {
    const conflict = await getConflictSnapshot(
      postId,
      existing.currentRevisionId,
      input.baseRevisionId,
    );
    if (!conflict.forceOverwriteAllowed) throw new EditConflictError(conflict);
  }
  const clean = validatePostInput(input);
  const visibilityUserIds =
    input.visibilityUserIds === undefined
      ? existing.visibilityUserIds
      : await normalizePostVisibility(input.visibilityUserIds, currentUserId);
  const visibilityChanged =
    JSON.stringify(visibilityUserIds) !== JSON.stringify(existing.visibilityUserIds);
  const db = getDb();
  const currentRevision = (
    await db
      .select()
      .from(postRevisions)
      .where(eq(postRevisions.id, existing.currentRevisionId))
      .limit(1)
  )[0];
  if (!currentRevision) throw new Error("帖子当前版本不存在");
  const nextAssetRefs = buildAssetSnapshot(clean.markdown, input.attachmentIds ?? []);
  const [currentAssetRefs, currentAnnotationRows, currentImportedReplyStates] = await db.batch([
    getCurrentAssetRefs(postId),
    getCurrentAnnotationSaveStates(postId),
    getCurrentImportedReplySaveStates(postId),
  ]);
  await validateSnapshotAssets(currentUserId, nextAssetRefs);
  const now = new Date();
  if (currentAnnotationRows.some((state) => state.annotationPostId !== postId))
    throw new AnnotationIntegrityError();
  const currentStates = currentAnnotationRows.map((state) => ({
    annotationId: state.annotationId,
    deletedAt: state.deletedAt,
    deletedByUserId: state.deletedByUserId,
    hiddenAt: state.hiddenAt,
    hiddenByUserId: state.hiddenByUserId,
  }));
  const currentAnchorIds = currentStates.map((state) => state.annotationId);
  if (!validateCanonicalAnnotationDocument(existing.markdown, currentAnchorIds).ok)
    throw new AnnotationIntegrityError();
  const annotationPlan = planAnnotatedPostSave({
    baseIds: currentAnchorIds,
    submittedMarkdown: clean.markdown,
    confirmedDeletionIds: input.confirmedAnnotationDeletionIds ?? [],
    currentStates,
    currentImportedReplyStates,
    actorUserId: currentUserId,
    at: now,
  });
  const savePlan = planContentSave(
    {
      revisionId: currentRevision.id,
      revisionNumber: currentRevision.revisionNumber,
      title: existing.title,
      markdown: existing.markdown,
      assetRefs: currentAssetRefs,
      editedAt: existing.editedAt,
      lastActivityAt: existing.lastActivityAt,
    },
    {
      title: clean.title,
      markdown: clean.markdown,
      assetRefs: nextAssetRefs,
    },
    now,
    { forceRevision: Boolean(input.overwriteBaseRevisionId) || visibilityChanged },
  );
  const tagOperations = await buildPostTagOperations(postId, clean.tags, now);
  const revisionGuard = db
    .update(posts)
    .set({
      title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${base.acceptedBaseRevisionId} THEN ${posts.title} ELSE NULL END`,
    })
    .where(eq(posts.id, postId));

  if (savePlan.kind === "metadata-only") {
    try {
      await commitPostSave((items) => db.batch(asBatch(items)), {
        guard: revisionGuard,
        content: [],
        annotations: [],
        assets: [],
        tags: tagOperations,
      });
    } catch (error) {
      const latest = (
        await db
          .select({ currentRevisionId: posts.currentRevisionId })
          .from(posts)
          .where(eq(posts.id, postId))
          .limit(1)
      )[0];
      if (latest?.currentRevisionId && latest.currentRevisionId !== base.acceptedBaseRevisionId) {
        throw new EditConflictError(
          await getConflictSnapshot(postId, latest.currentRevisionId, base.acceptedBaseRevisionId),
        );
      }
      throw error;
    }
    return { postId, currentRevisionId: currentRevision.id, revisionCreated: false };
  }

  const revisionId = crypto.randomUUID();
  tagOperations.push(db.update(posts).set({ visibilityUserIds }).where(eq(posts.id, postId)));
  const operations = buildAnnotatedPostSaveOperations(db, {
    postId,
    currentUserId,
    revisionId,
    revisionNumber: savePlan.revisionNumber,
    acceptedBaseRevisionId: base.acceptedBaseRevisionId,
    title: clean.title,
    markdown: clean.markdown,
    now,
    nextAssetRefs,
    annotationPlan,
    tagOperations,
  });

  try {
    await commitPostSave((items) => db.batch(asBatch(items)), operations);
  } catch (error) {
    const latest = (
      await db
        .select({ currentRevisionId: posts.currentRevisionId })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1)
    )[0];
    if (latest?.currentRevisionId && latest.currentRevisionId !== base.acceptedBaseRevisionId) {
      throw new EditConflictError(
        await getConflictSnapshot(postId, latest.currentRevisionId, base.acceptedBaseRevisionId),
      );
    }
    throw error;
  }
  return { postId, currentRevisionId: revisionId, revisionCreated: true };
}

export async function createReply(input: {
  postId: string;
  authorId: string;
  markdown: string;
  submissionKey: string;
  targetReplyId?: string;
}) {
  const markdown = validateReplyMarkdown(input.markdown);
  const submissionKey = validateSubmissionKey(input.submissionKey);
  const duplicate = await findReplyBySubmissionKey(input.authorId, submissionKey);
  if (duplicate) return duplicate.id;

  const post = (
    await getDb()
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(
        and(
          eq(posts.id, input.postId),
          isNull(posts.deletedAt),
          isNull(posts.hiddenAt),
          postVisibilityCondition(input.authorId),
        ),
      )
      .limit(1)
  )[0];
  if (!post) throw new Error("帖子不存在");
  let rootReplyId: string | null = null;
  let replyToReplyId: string | null = null;
  let replyToUserId: string | null = null;
  if (input.targetReplyId) {
    const target = await findReply(input.targetReplyId);
    if (!target || target.postId !== input.postId || target.deletedAt || target.hiddenAt)
      throw new Error("回复对象不存在");
    const normalized = normalizeReplyTarget({
      id: target.id,
      rootReplyId: target.rootReplyId,
      authorId: target.authorId,
    });
    rootReplyId = normalized.rootReplyId;
    replyToReplyId = normalized.replyToReplyId;
    replyToUserId = normalized.replyToUserId;
  }
  const now = new Date();
  const id = crypto.randomUUID();
  const eventId = activityEventId("POST_REPLY_CREATED", input.postId, id);
  const recipientUserId = resolveReplyRecipient({
    actorUserId: input.authorId,
    postAuthorId: post.authorId,
    replyToUserId,
  });
  const db = getDb();
  const replyInsert = db.insert(replies).values({
    id,
    postId: input.postId,
    authorId: input.authorId,
    rootReplyId,
    replyToReplyId,
    replyToUserId,
    submissionKey,
    markdown,
    publishedAt: now,
    deletedAt: null,
    deletedByUserId: null,
    hiddenAt: null,
    hiddenByUserId: null,
    hiddenReason: null,
  });
  const activityUpdate = db
    .update(posts)
    .set({
      lastActivityAt: now,
      title: sql<string>`CASE WHEN ${postVisibilityCondition(input.authorId)} AND ${posts.deletedAt} IS NULL AND ${posts.hiddenAt} IS NULL THEN ${posts.title} ELSE NULL END`,
    })
    .where(eq(posts.id, input.postId));
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
