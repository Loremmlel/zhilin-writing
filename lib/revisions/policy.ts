export type AssetUsage = "inline" | "attachment";

export type AssetSnapshotRef = {
  assetId: string;
  usage: AssetUsage;
};

type ComparablePostContent = {
  title: string;
  markdown: string;
  assetRefs: AssetSnapshotRef[];
};

const assetPathPattern = /\/api\/assets\/([\p{L}\p{N}._~-]+)/gu;

function stableAssetRefs(refs: AssetSnapshotRef[]): string[] {
  return [...new Set(refs.map((ref) => `${ref.assetId}:${ref.usage}`))].sort();
}

export function buildAssetSnapshot(markdown: string, attachmentIds: string[]): AssetSnapshotRef[] {
  const refs: AssetSnapshotRef[] = [];
  for (const assetId of new Set(attachmentIds.filter(Boolean))) {
    refs.push({ assetId, usage: "attachment" });
  }
  for (const match of markdown.matchAll(assetPathPattern)) {
    refs.push({ assetId: match[1], usage: "inline" });
  }
  return stableAssetRefs(refs).map((value) => {
    const separator = value.lastIndexOf(":");
    return {
      assetId: value.slice(0, separator),
      usage: value.slice(separator + 1) as AssetUsage,
    };
  });
}

export function classifyPostChange(current: ComparablePostContent, next: ComparablePostContent) {
  return {
    contentChanged:
      current.title !== next.title ||
      current.markdown !== next.markdown ||
      stableAssetRefs(current.assetRefs).join("\n") !== stableAssetRefs(next.assetRefs).join("\n"),
  };
}

export function resolveSaveBase(
  currentRevisionId: string,
  submittedBaseRevisionId: string,
  overwriteBaseRevisionId?: string,
) {
  const acceptedBaseRevisionId = overwriteBaseRevisionId ?? submittedBaseRevisionId;
  if (acceptedBaseRevisionId === currentRevisionId) {
    return { ok: true as const, acceptedBaseRevisionId };
  }
  return { ok: false as const, currentRevisionId, code: "EDIT_CONFLICT" as const };
}

export function nextRevisionNumber(currentMaximum: number | null | undefined): number {
  return (currentMaximum ?? 0) + 1;
}
