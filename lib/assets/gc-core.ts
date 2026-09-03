import { assetGcEligibility } from "../lifecycle/policy.ts";

export type AssetGcCandidate = {
  id: string;
  r2Key: string;
  byteSize: number;
  status: "temporary" | "permanent";
  createdAt: Date;
  expiresAt: Date | null;
};

export type AssetGcReferenceCounts = {
  currentRefCount: number;
  revisionRefCount: number;
  avatarRefCount: number;
};

export type AssetGcReason = "EXPIRED_TEMPORARY" | "PERMANENT_ORPHAN";
export type AssetGcFailureCode = "R2_UNAVAILABLE" | "R2_DELETE_FAILED" | "METADATA_UPDATE_FAILED";

export type AssetGcReport = {
  dryRun: boolean;
  inspected: number;
  candidateCount: number;
  bytes: number;
  candidates: Array<{ assetId: string; bytes: number; reason: AssetGcReason }>;
  collected: string[];
  failures: Array<{ assetId: string; code: AssetGcFailureCode }>;
};

export type UntrackedR2Candidate = {
  assetId: string;
  key: string;
  bytes: number;
  reason: "UNTRACKED_R2_OBJECT";
};

export function assetGcReason(candidate: AssetGcCandidate, refs: AssetGcReferenceCounts, now: Date): AssetGcReason | null {
  if (assetGcEligibility({ status: candidate.status, ...refs, expiresAt: candidate.expiresAt, now }) !== "eligible") return null;
  if (candidate.status === "temporary" && candidate.createdAt.getTime() > now.getTime() - 7 * 24 * 60 * 60 * 1000) return null;
  return candidate.status === "temporary" ? "EXPIRED_TEMPORARY" : "PERMANENT_ORPHAN";
}

export async function runAssetGcCandidates(input: {
  candidates: AssetGcCandidate[];
  now: Date;
  dryRun: boolean;
  dependencies: {
    referenceCounts(assetId: string): Promise<AssetGcReferenceCounts>;
    claim(assetId: string): Promise<boolean>;
    releaseClaim(assetId: string): Promise<void>;
    deleteObject(candidate: AssetGcCandidate): Promise<void>;
    markDeleted(assetId: string): Promise<void>;
    recordFailure(assetId: string, code: AssetGcFailureCode): Promise<void>;
  };
}): Promise<AssetGcReport> {
  const report: AssetGcReport = {
    dryRun: input.dryRun,
    inspected: input.candidates.length,
    candidateCount: 0,
    bytes: 0,
    candidates: [],
    collected: [],
    failures: [],
  };

  for (const candidate of input.candidates) {
    const reason = assetGcReason(candidate, await input.dependencies.referenceCounts(candidate.id), input.now);
    if (!reason) continue;
    report.candidateCount += 1;
    report.bytes += candidate.byteSize;
    report.candidates.push({ assetId: candidate.id, bytes: candidate.byteSize, reason });
    if (input.dryRun || !await input.dependencies.claim(candidate.id)) continue;

    const finalReason = assetGcReason(candidate, await input.dependencies.referenceCounts(candidate.id), input.now);
    if (!finalReason) {
      await input.dependencies.releaseClaim(candidate.id).catch(() => undefined);
      continue;
    }
    try {
      await input.dependencies.deleteObject(candidate);
    } catch (error) {
      const code: AssetGcFailureCode = error instanceof Error && error.message === "R2_UNAVAILABLE"
        ? "R2_UNAVAILABLE"
        : "R2_DELETE_FAILED";
      await input.dependencies.recordFailure(candidate.id, code).catch(() => undefined);
      report.failures.push({ assetId: candidate.id, code });
      continue;
    }
    try {
      await input.dependencies.markDeleted(candidate.id);
      report.collected.push(candidate.id);
    } catch {
      await input.dependencies.recordFailure(candidate.id, "METADATA_UPDATE_FAILED").catch(() => undefined);
      report.failures.push({ assetId: candidate.id, code: "METADATA_UPDATE_FAILED" });
    }
  }
  return report;
}

export function untrackedR2Candidates(
  objects: Array<{ key: string; size: number; uploaded: Date }>,
  trackedKeys: Set<string>,
  now: Date,
): UntrackedR2Candidate[] {
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return objects.flatMap((object) => {
    if (trackedKeys.has(object.key) || object.uploaded.getTime() > cutoff) return [];
    const match = /^[^/]+\/(?:avatar|image|attachment)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-/i.exec(object.key);
    return match ? [{ assetId: match[1].toLocaleLowerCase("en-US"), key: object.key, bytes: object.size, reason: "UNTRACKED_R2_OBJECT" as const }] : [];
  });
}

export function assertUntrackedR2Execution(candidates: UntrackedR2Candidate[], confirmedAssetIds: string[] | undefined): void {
  const actual = candidates.map((candidate) => candidate.assetId).sort();
  const confirmed = [...new Set(confirmedAssetIds ?? [])].sort();
  if (actual.length !== confirmed.length || actual.some((id, index) => id !== confirmed[index])) {
    throw new Error("R2 orphan execution requires the exact dry-run asset IDs");
  }
}
