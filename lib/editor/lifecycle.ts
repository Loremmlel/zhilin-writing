export type EditorSessionDescriptor = {
  compact: boolean;
  resetRevision: number;
  markdown: string;
};

export function editorSessionKey({ compact, resetRevision }: EditorSessionDescriptor) {
  return `${compact ? "compact" : "full"}:${resetRevision}`;
}
