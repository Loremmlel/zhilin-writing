export type AnnotationAnchorBox = { annotationId: string; top: number; right: number; height: number };
export type AnnotationConnector = { annotationId: string; path: string };
export type AnnotationClientRect = { top: number; right: number; bottom: number; left: number; width: number; height: number };

export function annotationThreadCapabilities(mode: "interactive" | "readonly") {
  const mutable = mode === "interactive";
  return {
    activate: true,
    locate: true,
    reply: mutable,
    delete: mutable,
    remove: mutable,
    moderate: false,
  };
}

export function visibleAnnotationIds(annotationIds: readonly string[], pendingRetiredIds: readonly string[]) {
  const retired = new Set(pendingRetiredIds);
  return annotationIds.filter((annotationId) => !retired.has(annotationId));
}

export function findAnnotationAnchorElements(root: Element, annotationId: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-annotation-id]")]
    .filter((element) => element.dataset.annotationId === annotationId);
}

export function findAnnotationIdFromTarget(root: Element, target: Element | null): string | null {
  const anchor = target?.closest<HTMLElement>("[data-annotation-id]") ?? null;
  return anchor && root.contains(anchor) ? anchor.dataset.annotationId ?? null : null;
}

export function annotationAnchorGeometry(
  rects: readonly AnnotationClientRect[],
  offset: { top: number; left: number },
): Omit<AnnotationAnchorBox, "annotationId"> | null {
  const visible = rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const representative = visible[0];
  if (!representative) return null;
  return {
    top: representative.top - offset.top,
    right: representative.right - offset.left,
    height: representative.height,
  };
}

export function annotationConnectorPath(input: { startX: number; startY: number; endX: number; endY: number }): string {
  const { startX, startY, endX, endY } = input;
  const distance = endX - startX;
  if (distance < 24) return `M ${startX} ${startY} L ${endX} ${endY}`;
  const bend = distance * .42;
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

export function sameAnnotationCardTops(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function sameAnnotationConnectors(left: AnnotationConnector[], right: AnnotationConnector[]): boolean {
  return left.length === right.length
    && left.every((connector, index) => connector.annotationId === right[index]?.annotationId && connector.path === right[index]?.path);
}

export function createAnnotationLayoutScheduler(
  measure: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id: number) => void = (id) => window.cancelAnimationFrame(id),
) {
  let frameId: number | null = null;
  let destroyed = false;
  return {
    schedule() {
      if (destroyed || frameId !== null) return;
      frameId = requestFrame(() => {
        frameId = null;
        if (!destroyed) measure();
      });
    },
    destroy() {
      destroyed = true;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    },
  };
}

export function layoutAnnotationCards(anchors: AnnotationAnchorBox[], cardHeights: Map<string, number>, gap: number) {
  const sorted = [...anchors].sort((a, b) => a.top - b.top || a.annotationId.localeCompare(b.annotationId));
  let cursor = 0;
  const cards = sorted.map((anchor) => {
    const top = Math.max(anchor.top, cursor);
    cursor = top + (cardHeights.get(anchor.annotationId) ?? 0) + gap;
    return { annotationId: anchor.annotationId, top };
  });
  return { cards, height: Math.max(0, cursor - gap) };
}
