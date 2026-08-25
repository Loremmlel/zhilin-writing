import { classifyPostChange, type AssetSnapshotRef } from "./policy.ts";

type CurrentRevisionState = {
  revisionId: string;
  revisionNumber: number;
  title: string;
  markdown: string;
  assetRefs: AssetSnapshotRef[];
  editedAt: Date | null;
  lastActivityAt: Date;
};

type NextContent = Pick<CurrentRevisionState, "title" | "markdown" | "assetRefs">;

export function planContentSave(
  current: CurrentRevisionState,
  next: NextContent,
  now: Date,
  options: { forceRevision?: boolean } = {},
) {
  if (!options.forceRevision && !classifyPostChange(current, next).contentChanged) {
    return {
      kind: "metadata-only" as const,
      currentRevisionId: current.revisionId,
      editedAt: current.editedAt,
      lastActivityAt: current.lastActivityAt,
    };
  }
  return {
    kind: "new-revision" as const,
    revisionNumber: current.revisionNumber + 1,
    editedAt: now,
    lastActivityAt: current.lastActivityAt,
  };
}

export function planRestore(
  current: CurrentRevisionState,
  source: { id: string } & NextContent,
  now: Date,
) {
  return {
    kind: "new-revision" as const,
    revisionNumber: current.revisionNumber + 1,
    title: source.title,
    markdown: source.markdown,
    assetRefs: source.assetRefs,
    restoreSourceRevisionId: source.id,
    editedAt: now,
    lastActivityAt: current.lastActivityAt,
  };
}
