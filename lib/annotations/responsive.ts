// 720px reading column + 70px gutter + 270px minimum rail.
export const ANNOTATION_DESKTOP_MIN_WIDTH = 1060;

export type AnnotationLayoutMode = "compact" | "desktop";

export function annotationLayoutMode(width: number): AnnotationLayoutMode {
  return width >= ANNOTATION_DESKTOP_MIN_WIDTH ? "desktop" : "compact";
}

export function shouldUseAnnotationSheet(width: number): boolean {
  return annotationLayoutMode(width) === "compact";
}

export function nextAnnotationSheetState(
  current: string | null,
  event: { type: "close" } | { type: "activate"; annotationId: string; compact: boolean },
): string | null {
  if (event.type === "close") return null;
  return event.compact ? event.annotationId : current;
}

export function resolveAnnotationSheetId(
  requestedId: string | null,
  visibleAnnotationIds: readonly string[],
): string | null {
  return requestedId && visibleAnnotationIds.includes(requestedId) ? requestedId : null;
}
