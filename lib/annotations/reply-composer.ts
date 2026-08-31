export type AnnotationReplyTarget = { replyId: string; displayName: string };
export type AnnotationReplyComposerState = { open: boolean; target: AnnotationReplyTarget | null };

export type AnnotationReplyComposerEvent =
  | { type: "root" }
  | { type: "reply"; replyId: string; displayName: string }
  | { type: "success" }
  | { type: "close" };

export type AnnotationDiscussionItem<T> =
  | { kind: "composer" }
  | { kind: "reply-count"; count: number }
  | { kind: "reply"; reply: T };

export function initialAnnotationReplyComposerState(): AnnotationReplyComposerState {
  return { open: false, target: null };
}

export function nextAnnotationReplyComposerState(state: AnnotationReplyComposerState, event: AnnotationReplyComposerEvent): AnnotationReplyComposerState {
  if (event.type === "close") return { open: false, target: null };
  if (event.type === "root" || event.type === "success") return { open: true, target: null };
  return { open: true, target: { replyId: event.replyId, displayName: event.displayName } };
}

export function annotationReplyComposerLabel(state: AnnotationReplyComposerState) {
  return state.target ? `回复 ${state.target.displayName}` : "回复这条批注";
}

export function buildAnnotationDiscussionItems<T>(replies: readonly T[]): AnnotationDiscussionItem<T>[] {
  return [
    { kind: "composer" },
    { kind: "reply-count", count: replies.length },
    ...replies.map((reply) => ({ kind: "reply" as const, reply })),
  ];
}

export function replyMarkdownAfterResult(markdown: string, result: { annotationReplyId?: string; error?: string }) {
  return result.annotationReplyId ? "" : markdown;
}
