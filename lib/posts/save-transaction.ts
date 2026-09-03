import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "../../db/schema.ts";
import type { AnnotatedPostSavePlan } from "../annotations/save-plan.ts";
import { markdownToPlainText } from "../markdown/render.ts";
import type { AssetSnapshotRef } from "../revisions/policy.ts";

export type ExistingTag = {
  id: string;
  name: string;
  normalizedName: string;
};

export type PlannedTag = ExistingTag & { createdAt: Date };

function stableTagId(normalizedName: string): string {
  const bytes = new TextEncoder().encode(normalizedName);
  return `tag:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function planPostTags(names: string[], existing: ExistingTag[], now: Date) {
  const existingByName = new Map(existing.map((tag) => [tag.normalizedName, tag]));
  const newTags: PlannedTag[] = [];
  const bindings = names.map((rawName) => {
    const name = rawName.trim();
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    const found = existingByName.get(normalizedName);
    if (found) return { tagId: found.id };
    const tag = { id: stableTagId(normalizedName), name, normalizedName, createdAt: now };
    newTags.push(tag);
    existingByName.set(normalizedName, tag);
    return { tagId: tag.id };
  });
  return { newTags, bindings };
}

export async function commitPostSave<T>(
  batch: (items: T[]) => Promise<unknown>,
  sections: {
    guard?: T;
    content: T[];
    annotations?: T[];
    assets: T[];
    tags: T[];
  },
) {
  const items = [
    ...(sections.guard ? [sections.guard] : []),
    ...sections.content,
    ...(sections.annotations ?? []),
    ...sections.assets,
    ...sections.tags,
  ];
  if (items.length === 0) throw new Error("保存事务不能为空");
  await batch(items);
}

export function buildAnnotatedPostSaveOperations(
  db: Pick<DrizzleD1Database<typeof schema>, "delete" | "insert" | "update">,
  input: {
    postId: string;
    currentUserId: string;
    revisionId: string;
    revisionNumber: number;
    acceptedBaseRevisionId: string;
    title: string;
    markdown: string;
    now: Date;
    nextAssetRefs: AssetSnapshotRef[];
    annotationPlan: AnnotatedPostSavePlan;
    tagOperations: BatchItem<"sqlite">[];
  },
) {
  const guard = db
    .update(schema.posts)
    .set({
      title: sql<string>`CASE WHEN ${schema.posts.currentRevisionId} = ${input.acceptedBaseRevisionId} THEN ${schema.posts.title} ELSE NULL END`,
    })
    .where(eq(schema.posts.id, input.postId));
  const content: BatchItem<"sqlite">[] = [
    db.insert(schema.postRevisions).values({
      id: input.revisionId,
      postId: input.postId,
      revisionNumber: input.revisionNumber,
      kind: "CONTENT_EDIT",
      title: input.title,
      markdown: input.markdown,
      createdAt: input.now,
      createdByUserId: input.currentUserId,
      restoreSourceRevisionId: null,
    }),
    db
      .update(schema.posts)
      .set({
        title: input.title,
        markdown: input.markdown,
        searchText: markdownToPlainText(input.markdown),
        currentRevisionId: input.revisionId,
        editedAt: input.now,
      })
      .where(
        and(
          eq(schema.posts.id, input.postId),
          eq(schema.posts.currentRevisionId, input.acceptedBaseRevisionId),
        ),
      ),
  ];
  const annotations: BatchItem<"sqlite">[] = [
    ...input.annotationPlan.delta.removed.map((annotationId) =>
      db
        .delete(schema.postAnnotationAnchors)
        .where(
          and(
            eq(schema.postAnnotationAnchors.postId, input.postId),
            eq(schema.postAnnotationAnchors.annotationId, annotationId),
          ),
        ),
    ),
    ...input.annotationPlan.retirements.map(({ annotationId, patch }) =>
      db
        .update(schema.annotations)
        .set(patch)
        .where(
          and(eq(schema.annotations.id, annotationId), eq(schema.annotations.postId, input.postId)),
        ),
    ),
    ...input.annotationPlan.retainedStates.map((state) =>
      db.insert(schema.revisionAnnotationStates).values({
        revisionId: input.revisionId,
        ...state,
      }),
    ),
    ...input.annotationPlan.retainedImportedReplyStates.map((state) =>
      db.insert(schema.revisionImportedReplyStates).values({
        revisionId: input.revisionId,
        annotationReplyId: state.annotationReplyId,
        deletedAt: state.deletedAt,
        deletedByUserId: state.deletedByUserId,
        hiddenAt: state.hiddenAt,
        hiddenByUserId: state.hiddenByUserId,
      }),
    ),
  ];
  const assets: BatchItem<"sqlite">[] = [
    db.delete(schema.postAssetRefs).where(eq(schema.postAssetRefs.postId, input.postId)),
    ...input.nextAssetRefs.map((ref) =>
      db.insert(schema.postAssetRefs).values({ postId: input.postId, ...ref }),
    ),
    ...input.nextAssetRefs.map((ref) =>
      db.insert(schema.revisionAssetRefs).values({ revisionId: input.revisionId, ...ref }),
    ),
    ...input.nextAssetRefs.map((ref) =>
      db
        .update(schema.assets)
        .set({
          postId: input.postId,
          status: sql<"permanent">`CASE WHEN ${schema.assets.gcClaimedAt} IS NULL AND ${schema.assets.deletedAt} IS NULL THEN 'permanent' ELSE NULL END`,
          boundAt: input.now,
          expiresAt: null,
        })
        .where(
          and(eq(schema.assets.id, ref.assetId), eq(schema.assets.ownerId, input.currentUserId)),
        ),
    ),
  ];
  return { guard, content, annotations, assets, tags: input.tagOperations };
}
