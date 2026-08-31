export type AnnotationAnchorBox = { annotationId: string; top: number; right: number; height: number };

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
