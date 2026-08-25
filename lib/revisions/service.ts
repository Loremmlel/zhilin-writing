import type { BatchItem } from "drizzle-orm/batch";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import {
  assets,
  postAssetRefs,
  postRevisions,
  postTags,
  posts,
  revisionAssetRefs,
  tags,
  users,
} from "@/db/schema";
import { markdownToPlainText } from "@/lib/markdown/render";
import type { AssetSnapshotRef } from "./policy";

export type RevisionSnapshot = {
  revision: typeof postRevisions.$inferSelect;
  assetRefs: AssetSnapshotRef[];
  assets: (typeof assets.$inferSelect)[];
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

export async function getRevisionSnapshot(postId: string, revisionId: string): Promise<RevisionSnapshot | null> {
  const revision = (await getDb().select().from(postRevisions).where(and(
    eq(postRevisions.id, revisionId),
    eq(postRevisions.postId, postId),
  )).limit(1))[0];
  if (!revision) return null;
  const assetRefs = await getRevisionAssetRefs(revision.id);
  const assetIds = [...new Set(assetRefs.map((ref) => ref.assetId))];
  const rows = assetIds.length === 0
    ? []
    : await getDb().select().from(assets).where(and(inArray(assets.id, assetIds), isNull(assets.deletedAt)));
  return { revision, assetRefs, assets: rows };
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

export async function restorePostRevision(postId: string, sourceRevisionId: string, administratorId: string) {
  const db = getDb();
  const post = (await db.select().from(posts).where(and(
    eq(posts.id, postId),
    isNull(posts.deletedAt),
    isNull(posts.hiddenAt),
  )).limit(1))[0];
  if (!post?.currentRevisionId) throw new Error("帖子当前版本不存在");
  const [current, source] = await Promise.all([
    getRevisionSnapshot(postId, post.currentRevisionId),
    getRevisionSnapshot(postId, sourceRevisionId),
  ]);
  if (!current || !source) throw new Error("历史版本不存在");

  const now = new Date();
  const revisionId = crypto.randomUUID();
  const operations: BatchItem<"sqlite">[] = [
    db.insert(postRevisions).values({
      id: revisionId,
      postId,
      revisionNumber: current.revision.revisionNumber + 1,
      title: source.revision.title,
      markdown: source.revision.markdown,
      createdAt: now,
      createdByUserId: administratorId,
      restoreSourceRevisionId: source.revision.id,
    }),
    db.update(posts).set({
      title: source.revision.title,
      markdown: source.revision.markdown,
      searchText: markdownToPlainText(source.revision.markdown),
      currentRevisionId: revisionId,
      editedAt: now,
    }).where(and(eq(posts.id, postId), eq(posts.currentRevisionId, current.revision.id))),
    db.delete(postAssetRefs).where(eq(postAssetRefs.postId, postId)),
    ...source.assetRefs.map((ref) => db.insert(postAssetRefs).values({ postId, ...ref })),
    ...source.assetRefs.map((ref) => db.insert(revisionAssetRefs).values({ revisionId, ...ref })),
  ];

  try {
    await db.batch(asBatch(operations));
  } catch (error) {
    const latest = (await db.select({ currentRevisionId: posts.currentRevisionId }).from(posts).where(eq(posts.id, postId)).limit(1))[0];
    if (latest?.currentRevisionId !== current.revision.id) throw new Error("帖子已更新，请刷新历史记录后重试");
    throw error;
  }
  return revisionId;
}
