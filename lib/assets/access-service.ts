import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { assets, postAssetRefs, posts, revisionAssetRefs, users } from "@/db/schema";
import { decideAssetReadAccess, type AssetAccessFacts, type AssetViewer } from "./access";

import { postVisibilityCondition } from "@/lib/posts/visibility";

export async function getAssetAccessFacts(
  assetId: string,
  viewerId: string,
): Promise<AssetAccessFacts | null> {
  const [facts] = await getDb()
    .select({
      status: assets.status,
      ownerId: assets.ownerId,
      avatarRefCount: sql<number>`(select count(*) from ${users} where ${users.avatarAssetId} = ${assetId})`,
      activeCurrentRefCount: sql<number>`(select count(*) from ${postAssetRefs} inner join ${posts} on ${posts.id} = ${postAssetRefs.postId} where ${postAssetRefs.assetId} = ${assetId} and ${posts.deletedAt} is null and ${posts.hiddenAt} is null and ${postVisibilityCondition(viewerId)})`,
      unavailableCurrentRefCount: sql<number>`(select count(*) from ${postAssetRefs} inner join ${posts} on ${posts.id} = ${postAssetRefs.postId} where ${postAssetRefs.assetId} = ${assetId} and (${posts.deletedAt} is not null or ${posts.hiddenAt} is not null))`,
      revisionRefCount: sql<number>`(select count(*) from ${revisionAssetRefs} where ${revisionAssetRefs.assetId} = ${assetId})`,
    })
    .from(assets)
    .where(andAssetAvailable(assetId))
    .limit(1);
  return facts ?? null;
}

function andAssetAvailable(assetId: string) {
  return and(eq(assets.id, assetId), isNull(assets.deletedAt));
}

export async function canReadAsset(assetId: string, viewer: AssetViewer) {
  const facts = await getAssetAccessFacts(assetId, viewer.userId);
  return facts ? decideAssetReadAccess(facts, viewer) === "allow" : false;
}
