import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { assets, postAssetRefs, posts, revisionAssetRefs, users } from "@/db/schema";
import { decideAssetReadAccess, type AssetAccessFacts, type AssetViewer } from "./access";

export async function getAssetAccessFacts(assetId: string): Promise<AssetAccessFacts | null> {
  const db = getDb();
  const asset = (await db.select().from(assets).where(andAssetAvailable(assetId)).limit(1))[0];
  if (!asset) return null;

  const [currentRefs, revisionRefs, avatarRefs] = await Promise.all([
    db.select({ deletedAt: posts.deletedAt, hiddenAt: posts.hiddenAt })
      .from(postAssetRefs)
      .innerJoin(posts, eq(postAssetRefs.postId, posts.id))
      .where(eq(postAssetRefs.assetId, assetId)),
    db.select({ assetId: revisionAssetRefs.assetId })
      .from(revisionAssetRefs)
      .where(eq(revisionAssetRefs.assetId, assetId)),
    db.select({ id: users.id })
      .from(users)
      .where(eq(users.avatarAssetId, assetId)),
  ]);

  return {
    status: asset.status,
    ownerId: asset.ownerId,
    avatarRefCount: avatarRefs.length,
    activeCurrentRefCount: currentRefs.filter((ref) => !ref.deletedAt && !ref.hiddenAt).length,
    unavailableCurrentRefCount: currentRefs.filter((ref) => ref.deletedAt || ref.hiddenAt).length,
    revisionRefCount: revisionRefs.length,
  };
}

function andAssetAvailable(assetId: string) {
  return and(eq(assets.id, assetId), isNull(assets.deletedAt));
}

export async function canReadAsset(assetId: string, viewer: AssetViewer) {
  const facts = await getAssetAccessFacts(assetId);
  return facts ? decideAssetReadAccess(facts, viewer) === "allow" : false;
}
