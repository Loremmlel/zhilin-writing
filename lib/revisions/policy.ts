import { collectAnnotationIds, parseAnnotationMarkdown } from "../annotations/markdown.ts";

export type AssetUsage = "inline" | "attachment";

export type AssetSnapshotRef = {
  assetId: string;
  usage: AssetUsage;
};

export type AnnotationStateSnapshot = {
  annotationId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  hiddenAt: Date | null;
  hiddenByUserId: string | null;
};

function assertMatchingAnnotationIds(label: string, left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  const consistent = a.length === new Set(a).size
    && b.length === new Set(b).size
    && a.length === b.length
    && a.every((id, index) => id === b[index]);
  if (!consistent) throw new Error(`${label}批注状态不一致`);
}

export function planAnnotationRestore(input: {
  currentMarkdown: string;
  currentAnchorIds: string[];
  currentStates: AnnotationStateSnapshot[];
  sourceMarkdown: string;
  sourceStates: AnnotationStateSnapshot[];
}) {
  const currentMarkdownIds = collectAnnotationIds(parseAnnotationMarkdown(input.currentMarkdown));
  const currentStateIds = input.currentStates.map((state) => state.annotationId);
  assertMatchingAnnotationIds("当前正文与锚点", currentMarkdownIds, input.currentAnchorIds);
  assertMatchingAnnotationIds("当前正文与快照", currentMarkdownIds, currentStateIds);

  const sourceAnchorIds = collectAnnotationIds(parseAnnotationMarkdown(input.sourceMarkdown));
  assertMatchingAnnotationIds("历史版本", sourceAnchorIds, input.sourceStates.map((state) => state.annotationId));
  const sourceSet = new Set(sourceAnchorIds);
  return {
    sourceAnchorIds,
    exitingAnnotationIds: currentMarkdownIds.filter((id) => !sourceSet.has(id)),
    restoredStates: sourceAnchorIds.map((id) => input.sourceStates.find((state) => state.annotationId === id)!),
  };
}

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
