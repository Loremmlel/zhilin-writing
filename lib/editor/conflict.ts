type EditorDraft = {
  title: string;
  markdown: string;
  tags: string;
  attachmentIds: string[];
  baseRevisionId: string | null;
};

type OnlineConflict = {
  revisionId: string;
  title: string;
  markdown: string;
  tags: string;
  attachmentIds: string[];
  forceOverwriteAllowed?: boolean;
  annotationStateChanged?: boolean;
};

export type ConflictChoice = "online" | "manual" | "overwrite";

export function availableConflictChoices(
  online: Pick<OnlineConflict, "revisionId" | "forceOverwriteAllowed" | "annotationStateChanged">,
): ConflictChoice[] {
  return online.forceOverwriteAllowed === false
    ? ["online", "manual"]
    : ["online", "manual", "overwrite"];
}

function stableIds(ids: string[]): string {
  return [...new Set(ids)].sort().join("\n");
}

export function hasRecoverablePublishedDraft(local: EditorDraft, server: EditorDraft): boolean {
  return (
    local.title !== server.title ||
    local.markdown !== server.markdown ||
    local.tags !== server.tags ||
    stableIds(local.attachmentIds) !== stableIds(server.attachmentIds) ||
    local.baseRevisionId !== server.baseRevisionId
  );
}

export function chooseConflictResolution(
  choice: ConflictChoice,
  local: EditorDraft,
  online: OnlineConflict,
) {
  if (choice === "online") {
    return {
      mode: "online" as const,
      title: online.title,
      markdown: online.markdown,
      tags: online.tags,
      attachmentIds: online.attachmentIds,
      baseRevisionId: online.revisionId,
      overwriteBaseRevisionId: null,
      conflictOpen: false,
    };
  }
  if (choice === "overwrite") {
    if (online.forceOverwriteAllowed === false)
      throw new Error("线上批注状态已经变化，不能使用旧正文覆盖");
    return {
      mode: "overwrite" as const,
      ...local,
      baseRevisionId: online.revisionId,
      overwriteBaseRevisionId: online.revisionId,
      conflictOpen: false,
      saveBlocked: false,
    };
  }
  return {
    mode: "manual" as const,
    ...local,
    overwriteBaseRevisionId: null,
    conflictOpen: false,
    saveBlocked: true,
  };
}
