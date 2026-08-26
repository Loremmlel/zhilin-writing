import { and, asc, eq, isNotNull, isNull, lte, notExists, or } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { assets, postAssetRefs, revisionAssetRefs, users } from "@/db/schema";
import { assetGcEligibility } from "@/lib/lifecycle/policy";

type ReferenceCounts = {
  currentRefCount: number;
  revisionRefCount: number;
  avatarRefCount: number;
};

async function referenceCounts(assetId: string): Promise<ReferenceCounts> {
  const db = getDb();
  const [current, revisions, avatars] = await Promise.all([
    db.select({ assetId: postAssetRefs.assetId }).from(postAssetRefs).where(eq(postAssetRefs.assetId, assetId)),
    db.select({ assetId: revisionAssetRefs.assetId }).from(revisionAssetRefs).where(eq(revisionAssetRefs.assetId, assetId)),
    db.select({ id: users.id }).from(users).where(eq(users.avatarAssetId, assetId)),
  ]);
  return {
    currentRefCount: current.length,
    revisionRefCount: revisions.length,
    avatarRefCount: avatars.length,
  };
}

export async function collectOrphanedAssets(options: { now?: Date; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 250);
  const db = getDb();
  const candidates = await db.select().from(assets)
    .where(and(
      isNull(assets.deletedAt),
      notExists(db.select({ assetId: postAssetRefs.assetId }).from(postAssetRefs).where(eq(postAssetRefs.assetId, assets.id))),
      notExists(db.select({ assetId: revisionAssetRefs.assetId }).from(revisionAssetRefs).where(eq(revisionAssetRefs.assetId, assets.id))),
      notExists(db.select({ id: users.id }).from(users).where(eq(users.avatarAssetId, assets.id))),
      or(
        eq(assets.status, "permanent"),
        and(eq(assets.status, "temporary"), isNotNull(assets.expiresAt), lte(assets.expiresAt, now)),
      ),
    ))
    .orderBy(asc(assets.createdAt))
    .limit(limit);
  const collected: string[] = [];

  for (const candidate of candidates) {
    const firstCheck = await referenceCounts(candidate.id);
    if (assetGcEligibility({
      status: candidate.status,
      ...firstCheck,
      expiresAt: candidate.expiresAt,
      now,
    }) !== "eligible") continue;

    // Recheck immediately before the destructive operation so a newly bound
    // current or revision reference wins the race against this cleanup pass.
    const finalCheck = await referenceCounts(candidate.id);
    if (assetGcEligibility({
      status: candidate.status,
      ...finalCheck,
      expiresAt: candidate.expiresAt,
      now,
    }) !== "eligible") continue;

    if (!env.BUCKET) throw new Error("R2 文件存储尚未连接");
    await env.BUCKET.delete(candidate.r2Key);
    await db.update(assets).set({ deletedAt: now }).where(and(
      eq(assets.id, candidate.id),
      isNull(assets.deletedAt),
    ));
    collected.push(candidate.id);
  }

  return { inspected: candidates.length, collected };
}
