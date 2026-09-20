export type AnnotationAnchorBox = {
  annotationId: string;
  top: number;
  right: number;
  height: number;
};
export type AnnotationConnector = { annotationId: string; path: string };
export type AnnotationClientRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

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

export function visibleAnnotationIds(
  annotationIds: readonly string[],
  pendingRetiredIds: readonly string[],
) {
  const retired = new Set(pendingRetiredIds);
  return annotationIds.filter((annotationId) => !retired.has(annotationId));
}

export function findAnnotationAnchorElements(root: Element, annotationId: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-annotation-id]")].filter(
    (element) => element.dataset.annotationId === annotationId,
  );
}

export function findAnnotationIdFromTarget(root: Element, target: Element | null): string | null {
  const anchor = target?.closest<HTMLElement>("[data-annotation-id]") ?? null;
  return anchor && root.contains(anchor) ? (anchor.dataset.annotationId ?? null) : null;
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

export function annotationConnectorPath(input: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}): string {
  const { startX, startY, endX, endY } = input;
  const distance = endX - startX;
  if (distance < 24) return `M ${startX} ${startY} L ${endX} ${endY}`;
  const bend = distance * 0.42;
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

export function sameAnnotationCardTops(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function sameAnnotationConnectors(
  left: AnnotationConnector[],
  right: AnnotationConnector[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (connector, index) =>
        connector.annotationId === right[index]?.annotationId &&
        connector.path === right[index]?.path,
    )
  );
}

export function createAnnotationLayoutScheduler(
  measure: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = (callback) =>
    window.requestAnimationFrame(callback),
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

export function layoutAnnotationCards(
  anchors: AnnotationAnchorBox[],
  cardHeights: Map<string, number>,
  gap: number,
  minTop = 0,
) {
  const sorted = [...anchors].sort(
    (a, b) => a.top - b.top || a.annotationId.localeCompare(b.annotationId),
  );
  const offsets: number[] = [];
  const groups: Array<{ start: number; count: number; sum: number }> = [];
  let offset = 0;

  // Subtract packed card heights so non-overlap becomes a nondecreasing sequence.
  // Pool adjacent conflicts (isotonic regression) to minimize squared anchor drift.
  sorted.forEach((anchor, index) => {
    offsets.push(offset);
    groups.push({ start: index, count: 1, sum: anchor.top - offset });
    offset += (cardHeights.get(anchor.annotationId) ?? 0) + gap;
    while (groups.length > 1) {
      const current = groups[groups.length - 1];
      const previous = groups[groups.length - 2];
      if (previous.sum / previous.count <= current.sum / current.count) break;
      previous.sum += current.sum;
      previous.count += current.count;
      groups.pop();
    }
  });

  const cards: Array<{ annotationId: string; top: number }> = [];
  for (const group of groups) {
    const top = Math.max(minTop, group.sum / group.count);
    for (let index = group.start; index < group.start + group.count; index += 1) {
      cards.push({ annotationId: sorted[index].annotationId, top: top + offsets[index] });
    }
  }
  const last = cards[cards.length - 1];
  return {
    cards,
    height: last ? last.top + (cardHeights.get(last.annotationId) ?? 0) : 0,
  };
}
