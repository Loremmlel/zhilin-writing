import { validateCanonicalAnnotationDocument } from "../annotations/invariants.ts";
import { planAnnotationRestoration, planAnnotationRetirement } from "../annotations/save-plan.ts";

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

export type ImportedReplyStateSnapshot = {
  annotationReplyId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  hiddenAt: Date | null;
  hiddenByUserId: string | null;
};

function assertMatchingAnnotationIds(label: string, left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  const consistent =
    a.length === new Set(a).size &&
    b.length === new Set(b).size &&
    a.length === b.length &&
    a.every((id, index) => id === b[index]);
  if (!consistent) throw new Error(`${label}批注状态不一致`);
}

function validatedAnnotationIds(label: string, markdown: string, knownIds: string[]): string[] {
  const validation = validateCanonicalAnnotationDocument(markdown, knownIds);
  if (!validation.ok) throw new Error(`${label}批注状态不一致`);
  return validation.anchors.map((anchor) => anchor.annotationId);
}

export function planAnnotationRestore(input: {
  currentMarkdown: string;
  currentAnchorIds: string[];
  currentStates: AnnotationStateSnapshot[];
  currentImportedReplyStates?: ImportedReplyStateSnapshot[];
  sourceMarkdown: string;
  sourceStates: AnnotationStateSnapshot[];
  sourceImportedReplyStates?: ImportedReplyStateSnapshot[];
  actorUserId: string;
  at: Date;
}) {
  const currentMarkdownIds = validatedAnnotationIds(
    "当前正文与锚点",
    input.currentMarkdown,
    input.currentAnchorIds,
  );
  const currentStateIds = input.currentStates.map((state) => state.annotationId);
  assertMatchingAnnotationIds("当前正文与快照", currentMarkdownIds, currentStateIds);

  const sourceStateIds = input.sourceStates.map((state) => state.annotationId);
  const sourceAnchorIds = validatedAnnotationIds("历史版本", input.sourceMarkdown, sourceStateIds);
  assertMatchingAnnotationIds("历史版本", sourceAnchorIds, sourceStateIds);
  const currentImportedReplyStates = input.currentImportedReplyStates ?? [];
  const sourceImportedReplyStates = input.sourceImportedReplyStates ?? [];
  assertUniqueImportedReplyStates("当前版本", currentImportedReplyStates);
  assertUniqueImportedReplyStates("历史版本", sourceImportedReplyStates);
  const sourceSet = new Set(sourceAnchorIds);
  const exitingAnnotationIds = currentMarkdownIds.filter((id) => !sourceSet.has(id));
  return {
    sourceAnchorIds,
    exitingAnnotationIds,
    restoredStates: sourceAnchorIds.map((id) =>
      input.sourceStates.find((state) => state.annotationId === id)!,
    ),
    restoredImportedReplyStates: sourceImportedReplyStates,
    retirements: planAnnotationRetirement(
      exitingAnnotationIds,
      input.actorUserId,
      input.at,
      "REVISION_RESTORE",
    ),
    restorations: planAnnotationRestoration(sourceAnchorIds),
  };
}

function assertUniqueImportedReplyStates(label: string, states: ImportedReplyStateSnapshot[]) {
  const ids = states.map((state) => state.annotationReplyId);
  if (ids.length !== new Set(ids).size) throw new Error(`${label}导入批注回复快照不一致`);
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
