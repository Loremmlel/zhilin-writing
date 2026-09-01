import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { activityEvents, assets, notifications, postAssetRefs, postRevisions, posts, postTags, replies, revisionAssetRefs, tags } from "@/db/schema";
import { findReply, findReplyBySubmissionKey, getPost } from "@/db/queries";
import { activityEventId, notificationId, resolveReplyRecipient, validateSubmissionKey } from "@/lib/activity/policy";
import { assertOrdinaryPostMarkdown } from "@/lib/annotations/policy";
import { getCurrentAnnotationSaveStates } from "@/lib/annotations/queries";
import { AnnotationIntegrityError, planAnnotatedPostSave } from "@/lib/annotations/save-plan";
import { validateCanonicalAnnotationDocument } from "@/lib/annotations/invariants";
import { canEditPost, normalizeReplyTarget, validatePostInput, validateReplyMarkdown } from "@/lib/domain/rules";
import { markdownToPlainText } from "@/lib/markdown/render";
import { buildAssetSnapshot, resolveSaveBase, type AssetSnapshotRef } from "@/lib/revisions/policy";
import { planContentSave } from "@/lib/revisions/save-plan";
import { EditConflictError, getConflictSnapshot, getCurrentAssetRefs, getCurrentImportedReplySaveStates } from "@/lib/revisions/service";
import { buildAnnotatedPostSaveOperations, commitPostSave, planPostTags } from "./save-transaction";

type SavePostInput = {
  title: string;
  markdown: string;
  tags: string[];
  attachmentIds?: string[];
  baseRevisionId?: string;
  overwriteBaseRevisionId?: string;
  confirmedAnnotationDeletionIds?: string[];
};

async function buildPostTagOperations(postId: string, names: string[], now: Date): Promise<BatchItem<"sqlite">[]> {
  const db = getDb();
  const normalizedNames = names.map((name) => name.toLocaleLowerCase("zh-CN"));
  const existing = normalizedNames.length === 0
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
  const rows = await getDb().select().from(assets).where(and(inArray(assets.id, ids), isNull(assets.deletedAt)));
  if (rows.length !== ids.length || rows.some((asset) => asset.ownerId !== authorId)) {
    throw new Error("帖子引用了无权使用或不存在的资源");
  }
}

export async function createPost(authorId: string, input: SavePostInput) {
  const clean = validatePostInput(input);
  assertOrdinaryPostMarkdown(clean.markdown);
  const now = new Date();
  const id = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const assetRefs = buildAssetSnapshot(clean.markdown, input.attachmentIds ?? []);
  await validateSnapshotAssets(authorId, assetRefs);
  const db = getDb();
  const tagOperations = await buildPostTagOperations(id, clean.tags, now);
  const contentOperations: BatchItem<"sqlite">[] = [
    db.insert(posts).values({
      id,
      authorId,
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
    ...assetRefs.map((ref) => db.update(assets).set({
      postId: id,
      status: "permanent",
      boundAt: now,
      expiresAt: null,
    }).where(and(eq(assets.id, ref.assetId), eq(assets.ownerId, authorId)))),
  ];
  await commitPostSave((items) => db.batch(asBatch(items)), {
    content: contentOperations,
    assets: assetOperations,
    tags: tagOperations,
  });
  return id;
}

export async function updatePost(postId: string, currentUserId: string, input: SavePostInput) {
  const existing = await getPost(postId);
  if (!existing) throw new Error("帖子不存在");
  if (!canEditPost(existing.post.authorId, currentUserId)) throw new Error("你不能编辑这篇帖子");
  if (!existing.post.currentRevisionId) throw new Error("帖子当前版本不存在");
  if (!input.baseRevisionId) throw new Error("缺少编辑基础版本，请刷新后重试");
  const base = resolveSaveBase(existing.post.currentRevisionId, input.baseRevisionId, input.overwriteBaseRevisionId);
  if (!base.ok) throw new EditConflictError(await getConflictSnapshot(postId, base.currentRevisionId, input.baseRevisionId));
  if (input.overwriteBaseRevisionId) {
    const conflict = await getConflictSnapshot(postId, existing.post.currentRevisionId, input.baseRevisionId);
    if (!conflict.forceOverwriteAllowed) throw new EditConflictError(conflict);
  }
  const clean = validatePostInput(input);
  const db = getDb();
  const currentRevision = (await db.select().from(postRevisions).where(eq(postRevisions.id, existing.post.currentRevisionId)).limit(1))[0];
  if (!currentRevision) throw new Error("帖子当前版本不存在");
  const [currentAssetRefs, nextAssetRefs, currentAnnotationRows, currentImportedReplyStates] = await Promise.all([
    getCurrentAssetRefs(postId),
    Promise.resolve(buildAssetSnapshot(clean.markdown, input.attachmentIds ?? [])),
    getCurrentAnnotationSaveStates(postId),
    getCurrentImportedReplySaveStates(postId),
  ]);
  await validateSnapshotAssets(currentUserId, nextAssetRefs);
  const now = new Date();
  if (currentAnnotationRows.some((state) => state.annotationPostId !== postId)) throw new AnnotationIntegrityError();
  const currentStates = currentAnnotationRows.map((state) => ({
    annotationId: state.annotationId,
    deletedAt: state.deletedAt,
    deletedByUserId: state.deletedByUserId,
    hiddenAt: state.hiddenAt,
    hiddenByUserId: state.hiddenByUserId,
  }));
  const currentAnchorIds = currentStates.map((state) => state.annotationId);
  if (!validateCanonicalAnnotationDocument(existing.post.markdown, currentAnchorIds).ok) throw new AnnotationIntegrityError();
  const annotationPlan = planAnnotatedPostSave({
    baseIds: currentAnchorIds,
    submittedMarkdown: clean.markdown,
    confirmedDeletionIds: input.confirmedAnnotationDeletionIds ?? [],
    currentStates,
    currentImportedReplyStates,
    actorUserId: currentUserId,
    at: now,
  });
  const savePlan = planContentSave({
    revisionId: currentRevision.id,
    revisionNumber: currentRevision.revisionNumber,
    title: existing.post.title,
    markdown: existing.post.markdown,
    assetRefs: currentAssetRefs,
    editedAt: existing.post.editedAt,
    lastActivityAt: existing.post.lastActivityAt,
  }, {
    title: clean.title,
    markdown: clean.markdown,
    assetRefs: nextAssetRefs,
  }, now, { forceRevision: Boolean(input.overwriteBaseRevisionId) });
  const tagOperations = await buildPostTagOperations(postId, clean.tags, now);
  const revisionGuard = db.update(posts).set({
    title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${base.acceptedBaseRevisionId} THEN ${posts.title} ELSE NULL END`,
  }).where(eq(posts.id, postId));

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
      const latest = (await db.select({ currentRevisionId: posts.currentRevisionId }).from(posts).where(eq(posts.id, postId)).limit(1))[0];
      if (latest?.currentRevisionId && latest.currentRevisionId !== base.acceptedBaseRevisionId) {
        throw new EditConflictError(await getConflictSnapshot(postId, latest.currentRevisionId, base.acceptedBaseRevisionId));
      }
      throw error;
    }
    return { postId, currentRevisionId: currentRevision.id, revisionCreated: false };
  }

  const revisionId = crypto.randomUUID();
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
    const latest = (await db.select({ currentRevisionId: posts.currentRevisionId }).from(posts).where(eq(posts.id, postId)).limit(1))[0];
    if (latest?.currentRevisionId && latest.currentRevisionId !== base.acceptedBaseRevisionId) {
      throw new EditConflictError(await getConflictSnapshot(postId, latest.currentRevisionId, base.acceptedBaseRevisionId));
    }
    throw error;
  }
  return { postId, currentRevisionId: revisionId, revisionCreated: true };
}

export async function createReply(input: { postId: string; authorId: string; markdown: string; submissionKey: string; targetReplyId?: string }) {
  const markdown = validateReplyMarkdown(input.markdown);
  const submissionKey = validateSubmissionKey(input.submissionKey);
  const duplicate = await findReplyBySubmissionKey(input.authorId, submissionKey);
  if (duplicate) return duplicate.id;

  const post = await getPost(input.postId);
  if (!post) throw new Error("帖子不存在");
  let rootReplyId: string | null = null;
  let replyToReplyId: string | null = null;
  let replyToUserId: string | null = null;
  if (input.targetReplyId) {
    const target = await findReply(input.targetReplyId);
    if (!target || target.postId !== input.postId || target.deletedAt || target.hiddenAt) throw new Error("回复对象不存在");
    const normalized = normalizeReplyTarget({ id: target.id, rootReplyId: target.rootReplyId, authorId: target.authorId });
    rootReplyId = normalized.rootReplyId;
    replyToReplyId = normalized.replyToReplyId;
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
    id, postId: input.postId, authorId: input.authorId, rootReplyId, replyToReplyId, replyToUserId,
    submissionKey, markdown, publishedAt: now,
    deletedAt: null, deletedByUserId: null,
    hiddenAt: null, hiddenByUserId: null, hiddenReason: null,
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
