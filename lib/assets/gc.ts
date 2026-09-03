import { and, asc, eq, inArray, isNotNull, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { assets, postAssetRefs, revisionAssetRefs, users } from "@/db/schema";
import { assertUntrackedR2Execution, runAssetGcCandidates, untrackedR2Candidates, type AssetGcFailureCode } from "./gc-core";

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

export async function collectOrphanedAssets(options: { now?: Date; limit?: number; dryRun?: boolean } = {}) {
  const now = options.now ?? new Date();
  const staleClaimBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const temporaryCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 250);
  const db = getDb();
  const candidates = await db.select().from(assets)
    .where(and(
      isNull(assets.deletedAt),
      or(isNull(assets.gcClaimedAt), lte(assets.gcClaimedAt, staleClaimBefore)),
      notExists(db.select({ assetId: postAssetRefs.assetId }).from(postAssetRefs).where(eq(postAssetRefs.assetId, assets.id))),
      notExists(db.select({ assetId: revisionAssetRefs.assetId }).from(revisionAssetRefs).where(eq(revisionAssetRefs.assetId, assets.id))),
      notExists(db.select({ id: users.id }).from(users).where(eq(users.avatarAssetId, assets.id))),
      or(
        eq(assets.status, "permanent"),
        and(eq(assets.status, "temporary"), lte(assets.createdAt, temporaryCutoff), isNotNull(assets.expiresAt), lte(assets.expiresAt, now)),
      ),
    ))
    .orderBy(asc(assets.createdAt))
    .limit(limit);

  return runAssetGcCandidates({
    candidates,
    now,
    dryRun: options.dryRun ?? true,
    dependencies: {
      referenceCounts,
      async claim(assetId) {
        const [claimed] = await db.update(assets).set({ gcClaimedAt: now }).where(and(
          eq(assets.id, assetId),
          isNull(assets.deletedAt),
          or(isNull(assets.gcClaimedAt), lte(assets.gcClaimedAt, staleClaimBefore)),
          notExists(db.select({ assetId: postAssetRefs.assetId }).from(postAssetRefs).where(eq(postAssetRefs.assetId, assets.id))),
          notExists(db.select({ assetId: revisionAssetRefs.assetId }).from(revisionAssetRefs).where(eq(revisionAssetRefs.assetId, assets.id))),
          notExists(db.select({ id: users.id }).from(users).where(eq(users.avatarAssetId, assets.id))),
        )).returning({ id: assets.id });
        return Boolean(claimed);
      },
      async releaseClaim(assetId) {
        await db.update(assets).set({ gcClaimedAt: null }).where(and(eq(assets.id, assetId), eq(assets.gcClaimedAt, now)));
      },
      async deleteObject(candidate) {
        if (!env.BUCKET) throw new Error("R2_UNAVAILABLE");
        await env.BUCKET.delete(candidate.r2Key);
      },
      async markDeleted(assetId) {
        const [deleted] = await db.update(assets).set({
          deletedAt: now,
          gcClaimedAt: null,
          gcFailureCount: 0,
          gcLastFailedAt: null,
          gcLastErrorCode: null,
        }).where(and(eq(assets.id, assetId), eq(assets.gcClaimedAt, now))).returning({ id: assets.id });
        if (!deleted) throw new Error("GC metadata claim was lost");
      },
      async recordFailure(assetId, code: AssetGcFailureCode) {
        await db.update(assets).set({
          gcFailureCount: sql`${assets.gcFailureCount} + 1`,
          gcLastFailedAt: now,
          gcLastErrorCode: code,
        }).where(eq(assets.id, assetId));
      },
    },
  });
}

export async function scanUntrackedR2Objects(options: {
  ownerPrefix: string;
  now?: Date;
  cursor?: string;
  limit?: number;
  dryRun?: boolean;
  confirmedAssetIds?: string[];
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/$/i.test(options.ownerPrefix)) {
    throw new Error("R2 inventory scan requires one exact owner UUID prefix");
  }
  if (!env.BUCKET) throw new Error("R2_UNAVAILABLE");
  const now = options.now ?? new Date();
  const page = await env.BUCKET.list({
    prefix: options.ownerPrefix.toLocaleLowerCase("en-US"),
    cursor: options.cursor,
    limit: Math.min(Math.max(options.limit ?? 90, 1), 90),
  });
  const keys = page.objects.map((object) => object.key);
  const tracked = keys.length === 0 ? [] : await getDb().select({ r2Key: assets.r2Key }).from(assets).where(inArray(assets.r2Key, keys));
  const candidates = untrackedR2Candidates(page.objects, new Set(tracked.map((asset) => asset.r2Key)), now);
  const report = {
    dryRun: options.dryRun ?? true,
    inspected: page.objects.length,
    candidateCount: candidates.length,
    bytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
    candidates: candidates.map(({ assetId, bytes, reason }) => ({ assetId, bytes, reason })),
    collected: [] as string[],
    failures: [] as Array<{ assetId: string; code: "R2_DELETE_FAILED" }>,
    nextCursor: page.truncated ? page.cursor : undefined,
  };
  if (report.dryRun) return report;
  assertUntrackedR2Execution(candidates, options.confirmedAssetIds);
  for (const candidate of candidates) {
    const trackedNow = (await getDb().select({ id: assets.id }).from(assets).where(eq(assets.r2Key, candidate.key)).limit(1))[0];
    if (trackedNow) continue;
    try {
      await env.BUCKET.delete(candidate.key);
      report.collected.push(candidate.assetId);
    } catch {
      report.failures.push({ assetId: candidate.assetId, code: "R2_DELETE_FAILED" });
    }
  }
  return report;
}
