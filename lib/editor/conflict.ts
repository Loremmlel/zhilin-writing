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
};

function stableIds(ids: string[]): string {
  return [...new Set(ids)].sort().join("\n");
}

export function hasRecoverablePublishedDraft(local: EditorDraft, server: EditorDraft): boolean {
  return local.title !== server.title ||
    local.markdown !== server.markdown ||
    local.tags !== server.tags ||
    stableIds(local.attachmentIds) !== stableIds(server.attachmentIds) ||
    local.baseRevisionId !== server.baseRevisionId;
}

export function chooseConflictResolution(
  choice: "online" | "manual" | "overwrite",
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
