export type AnnotationAnchorBox = { annotationId: string; top: number; right: number; height: number };

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
