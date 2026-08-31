export function shouldUseAnnotationSheet(width: number): boolean { return width <= 900; }

export function nextAnnotationSheetState(current: string | null, event: { type: "close" } | { type: "activate"; annotationId: string; compact: boolean }): string | null {
  if (event.type === "close") return null;
  return event.compact ? event.annotationId : current;
}

export function resolveAnnotationSheetId(requestedId: string | null, visibleAnnotationIds: readonly string[]): string | null {
  return requestedId && visibleAnnotationIds.includes(requestedId) ? requestedId : null;
}
