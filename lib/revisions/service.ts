import type { BatchItem } from "drizzle-orm/batch";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  assets,
  adminAuditLog,
  annotationReplies,
  annotations,
  postAnnotationAnchors,
  postAssetRefs,
  postRevisions,
  postTags,
  posts,
  revisionAssetRefs,
  revisionAnnotationStates,
  revisionImportedReplyStates,
  tags,
  users,
} from "@/db/schema";
import { markdownToPlainText } from "@/lib/markdown/render";
import { planAnnotationRestore, type AnnotationStateSnapshot, type AssetSnapshotRef, type ImportedReplyStateSnapshot } from "./policy";
import { planRestore } from "./save-plan";

export type RevisionSnapshot = {
  revision: typeof postRevisions.$inferSelect;
  assetRefs: AssetSnapshotRef[];
  assets: (typeof assets.$inferSelect)[];
  annotationStates: AnnotationStateSnapshot[];
  importedReplyStates: ImportedReplyStateSnapshot[];
};

export type EditConflictSnapshot = {
  revisionId: string;
  revisionNumber: number;
  title: string;
  markdown: string;
  tags: string[];
  assetRefs: AssetSnapshotRef[];
  attachments: Array<{ id: string; filename: string; mimeType: string; byteSize: number }>;
};

export class EditConflictError extends Error {
  readonly code = "EDIT_CONFLICT" as const;

  constructor(readonly current: EditConflictSnapshot) {
    super("帖子已在其他设备或窗口中更新");
    this.name = "EditConflictError";
  }
}

export async function getCurrentAssetRefs(postId: string): Promise<AssetSnapshotRef[]> {
  return getDb()
    .select({ assetId: postAssetRefs.assetId, usage: postAssetRefs.usage })
    .from(postAssetRefs)
    .where(eq(postAssetRefs.postId, postId))
    .orderBy(asc(postAssetRefs.assetId), asc(postAssetRefs.usage));
}

export async function getRevisionAssetRefs(revisionId: string): Promise<AssetSnapshotRef[]> {
  return getDb()
    .select({ assetId: revisionAssetRefs.assetId, usage: revisionAssetRefs.usage })
    .from(revisionAssetRefs)
    .where(eq(revisionAssetRefs.revisionId, revisionId))
    .orderBy(asc(revisionAssetRefs.assetId), asc(revisionAssetRefs.usage));
}

export async function getRevisionAnnotationStates(revisionId: string): Promise<AnnotationStateSnapshot[]> {
  return getDb()
    .select({
      annotationId: revisionAnnotationStates.annotationId,
      deletedAt: revisionAnnotationStates.deletedAt,
      deletedByUserId: revisionAnnotationStates.deletedByUserId,
      hiddenAt: revisionAnnotationStates.hiddenAt,
      hiddenByUserId: revisionAnnotationStates.hiddenByUserId,
    })
    .from(revisionAnnotationStates)
    .where(eq(revisionAnnotationStates.revisionId, revisionId))
    .orderBy(asc(revisionAnnotationStates.annotationId));
}

export async function getRevisionImportedReplyStates(revisionId: string): Promise<ImportedReplyStateSnapshot[]> {
  return getDb()
    .select({
      annotationReplyId: revisionImportedReplyStates.annotationReplyId,
      deletedAt: revisionImportedReplyStates.deletedAt,
      deletedByUserId: revisionImportedReplyStates.deletedByUserId,
      hiddenAt: revisionImportedReplyStates.hiddenAt,
      hiddenByUserId: revisionImportedReplyStates.hiddenByUserId,
    })
    .from(revisionImportedReplyStates)
    .where(eq(revisionImportedReplyStates.revisionId, revisionId))
    .orderBy(asc(revisionImportedReplyStates.annotationReplyId));
}

export async function getCurrentImportedReplyStates(postId: string): Promise<ImportedReplyStateSnapshot[]> {
  return getDb()
    .select({
      annotationReplyId: annotationReplies.id,
      deletedAt: annotationReplies.deletedAt,
      deletedByUserId: annotationReplies.deletedByUserId,
      hiddenAt: annotationReplies.hiddenAt,
      hiddenByUserId: annotationReplies.hiddenByUserId,
    })
    .from(annotationReplies)
    .innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id))
    .where(and(eq(annotations.postId, postId), eq(annotationReplies.sourceType, "DOCX_IMPORT")))
    .orderBy(asc(annotationReplies.id));
}

export async function getRevisionSnapshot(postId: string, revisionId: string): Promise<RevisionSnapshot | null> {
  const revision = (await getDb().select().from(postRevisions).where(and(
    eq(postRevisions.id, revisionId),
    eq(postRevisions.postId, postId),
  )).limit(1))[0];
  if (!revision) return null;
  const [assetRefs, annotationStates, importedReplyStates] = await Promise.all([
    getRevisionAssetRefs(revision.id),
    getRevisionAnnotationStates(revision.id),
    getRevisionImportedReplyStates(revision.id),
  ]);
  const assetIds = [...new Set(assetRefs.map((ref) => ref.assetId))];
  const rows = assetIds.length === 0
    ? []
    : await getDb().select().from(assets).where(and(inArray(assets.id, assetIds), isNull(assets.deletedAt)));
  return { revision, assetRefs, assets: rows, annotationStates, importedReplyStates };
}

export async function getConflictSnapshot(postId: string, revisionId: string): Promise<EditConflictSnapshot> {
  const snapshot = await getRevisionSnapshot(postId, revisionId);
  if (!snapshot) throw new Error("当前帖子版本不存在");
  const currentTags = await getDb()
    .select({ name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, postId))
    .orderBy(asc(tags.name));
  const attachmentIds = new Set(snapshot.assetRefs.filter((ref) => ref.usage === "attachment").map((ref) => ref.assetId));
  return {
    revisionId: snapshot.revision.id,
    revisionNumber: snapshot.revision.revisionNumber,
    title: snapshot.revision.title,
    markdown: snapshot.revision.markdown,
    tags: currentTags.map((tag) => tag.name),
    assetRefs: snapshot.assetRefs,
    attachments: snapshot.assets
      .filter((asset) => attachmentIds.has(asset.id))
      .map((asset) => ({ id: asset.id, filename: asset.filename, mimeType: asset.mimeType, byteSize: asset.byteSize })),
  };
}

export async function listPostRevisions(postId: string) {
  return getDb()
    .select({ revision: postRevisions, creator: users })
    .from(postRevisions)
    .innerJoin(users, eq(postRevisions.createdByUserId, users.id))
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.revisionNumber));
}

function asBatch(items: BatchItem<"sqlite">[]) {
  if (items.length === 0) throw new Error("保存事务不能为空");
  return items as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
}

export async function restorePostRevision(postId: string, sourceRevisionId: string, administratorId: string, operationId: string) {
  const db = getDb();
  const dedupeKey = `REVISION_RESTORED:POST:${postId}:${sourceRevisionId}:${operationId}`;
  const existingAudit = (await db.select().from(adminAuditLog).where(eq(adminAuditLog.dedupeKey, dedupeKey)).limit(1))[0];
  if (existingAudit?.metadataJson) {
    const metadata = JSON.parse(existingAudit.metadataJson) as { newRevisionId?: string };
    if (metadata.newRevisionId) return metadata.newRevisionId;
  }

  const post = (await db.select().from(posts).where(eq(posts.id, postId)).limit(1))[0];
  if (!post?.currentRevisionId) throw new Error("帖子当前版本不存在");
  const [current, source] = await Promise.all([
    getRevisionSnapshot(postId, post.currentRevisionId),
    getRevisionSnapshot(postId, sourceRevisionId),
  ]);
  if (!current || !source) throw new Error("历史版本不存在");

  const currentAnchorIds = await db.select({ annotationId: postAnnotationAnchors.annotationId })
    .from(postAnnotationAnchors)
    .where(eq(postAnnotationAnchors.postId, postId))
    .orderBy(asc(postAnnotationAnchors.annotationId))
    .then((rows) => rows.map((row) => row.annotationId));
  const annotationRestore = planAnnotationRestore({
    currentMarkdown: current.revision.markdown,
    currentAnchorIds,
    currentStates: current.annotationStates,
    currentImportedReplyStates: current.importedReplyStates,
    sourceMarkdown: source.revision.markdown,
    sourceStates: source.annotationStates,
    sourceImportedReplyStates: source.importedReplyStates,
  });
  if (annotationRestore.sourceAnchorIds.length > 0) {
    const sourceRows = await db.select({ id: annotations.id, postId: annotations.postId })
      .from(annotations)
      .where(inArray(annotations.id, annotationRestore.sourceAnchorIds));
    const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
    if (annotationRestore.sourceAnchorIds.some((id) => sourceById.get(id)?.postId !== postId)) {
      throw new Error("历史版本包含不存在或不属于当前帖子的批注");
    }
  }
  if (annotationRestore.restoredImportedReplyStates.length > 0) {
    const replyIds = annotationRestore.restoredImportedReplyStates.map((state) => state.annotationReplyId);
    const sourceRows = await db.select({ id: annotationReplies.id, postId: annotations.postId })
      .from(annotationReplies)
      .innerJoin(annotations, eq(annotationReplies.annotationId, annotations.id))
      .where(and(inArray(annotationReplies.id, replyIds), eq(annotationReplies.sourceType, "DOCX_IMPORT")));
    const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
    if (replyIds.some((id) => sourceById.get(id)?.postId !== postId)) {
      throw new Error("历史版本包含不存在或不属于当前帖子的导入批注回复");
    }
  }

  const now = new Date();
  const revisionId = crypto.randomUUID();
  const restorePlan = planRestore({
    revisionId: current.revision.id,
    revisionNumber: current.revision.revisionNumber,
    title: current.revision.title,
    markdown: current.revision.markdown,
    assetRefs: current.assetRefs,
    editedAt: post.editedAt,
    lastActivityAt: post.lastActivityAt,
  }, {
    id: source.revision.id,
    title: source.revision.title,
    markdown: source.revision.markdown,
    assetRefs: source.assetRefs,
  }, now);
  const operations: BatchItem<"sqlite">[] = [
    db.update(posts).set({
      title: sql<string>`CASE WHEN ${posts.currentRevisionId} = ${current.revision.id} THEN ${posts.title} ELSE NULL END`,
    }).where(eq(posts.id, postId)),
    db.insert(postRevisions).values({
      id: revisionId,
      postId,
      revisionNumber: restorePlan.revisionNumber,
      kind: "RESTORE",
      title: restorePlan.title,
      markdown: restorePlan.markdown,
      createdAt: now,
      createdByUserId: administratorId,
      restoreSourceRevisionId: restorePlan.restoreSourceRevisionId,
    }),
    db.update(posts).set({
      title: restorePlan.title,
      markdown: restorePlan.markdown,
      searchText: markdownToPlainText(restorePlan.markdown),
      currentRevisionId: revisionId,
      editedAt: restorePlan.editedAt,
      deletedAt: null,
      deletedByUserId: null,
    }).where(and(eq(posts.id, postId), eq(posts.currentRevisionId, current.revision.id))),
    db.delete(postAssetRefs).where(eq(postAssetRefs.postId, postId)),
    ...restorePlan.assetRefs.map((ref) => db.insert(postAssetRefs).values({ postId, ...ref })),
    ...restorePlan.assetRefs.map((ref) => db.insert(revisionAssetRefs).values({ revisionId, ...ref })),
    db.delete(postAnnotationAnchors).where(eq(postAnnotationAnchors.postId, postId)),
    ...annotationRestore.sourceAnchorIds.map((annotationId) => db.insert(postAnnotationAnchors).values({ postId, annotationId })),
    ...annotationRestore.restoredStates.map((state) => db.update(annotations).set({
      deletedAt: state.deletedAt,
      deletedByUserId: state.deletedByUserId,
      hiddenAt: state.hiddenAt,
      hiddenByUserId: state.hiddenByUserId,
      hiddenReason: null,
    }).where(and(eq(annotations.id, state.annotationId), eq(annotations.postId, postId)))),
    ...annotationRestore.restoredStates.map((state) => db.insert(revisionAnnotationStates).values({ revisionId, ...state })),
    ...annotationRestore.restoredImportedReplyStates.map((state) => db.update(annotationReplies).set({
      deletedAt: state.deletedAt,
      deletedByUserId: state.deletedByUserId,
      hiddenAt: state.hiddenAt,
      hiddenByUserId: state.hiddenByUserId,
      hiddenReason: null,
    }).where(and(eq(annotationReplies.id, state.annotationReplyId), eq(annotationReplies.sourceType, "DOCX_IMPORT")))),
    ...annotationRestore.restoredImportedReplyStates.map((state) => db.insert(revisionImportedReplyStates).values({ revisionId, ...state })),
    db.insert(adminAuditLog).values({
      id: crypto.randomUUID(),
      adminUserId: administratorId,
      actionType: "REVISION_RESTORED",
      targetType: "POST",
      targetId: postId,
      createdAt: now,
      metadataJson: JSON.stringify({
        sourceRevisionId,
        newRevisionId: revisionId,
        annotationCount: annotationRestore.sourceAnchorIds.length,
        exitingAnnotationCount: annotationRestore.exitingAnnotationIds.length,
        importedReplyCount: annotationRestore.restoredImportedReplyStates.length,
      }),
      dedupeKey,
    }),
  ];

  try {
    await db.batch(asBatch(operations));
  } catch (error) {
    const completedAudit = (await db.select().from(adminAuditLog).where(eq(adminAuditLog.dedupeKey, dedupeKey)).limit(1))[0];
    if (completedAudit?.metadataJson) {
      const metadata = JSON.parse(completedAudit.metadataJson) as { newRevisionId?: string };
      if (metadata.newRevisionId) return metadata.newRevisionId;
    }
    const latest = (await db.select({ currentRevisionId: posts.currentRevisionId }).from(posts).where(eq(posts.id, postId)).limit(1))[0];
    if (latest?.currentRevisionId !== current.revision.id) throw new Error("帖子已更新，请刷新历史记录后重试");
    throw error;
  }
  return revisionId;
}
