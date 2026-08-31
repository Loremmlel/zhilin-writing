"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AnnotationReadonlyThread } from "@/components/annotations/annotation-readonly-thread";
import { AnnotationSheet } from "@/components/annotations/annotation-sheet";
import type { AnnotationCardView } from "@/components/annotations/annotation-thread";
import {
  createAnnotationLayoutScheduler,
  findAnnotationAnchorElements,
  findAnnotationIdFromTarget,
  layoutAnnotationCards,
  visibleAnnotationIds,
} from "@/lib/annotations/layout";
import { resolveAnnotationSheetId, shouldUseAnnotationSheet } from "@/lib/annotations/responsive";

type Connector = { annotationId: string; path: string };

function sameNumberRecord(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

function sameConnectors(left: Connector[], right: Connector[]) {
  return left.length === right.length
    && left.every((connector, index) => connector.annotationId === right[index]?.annotationId && connector.path === right[index]?.path);
}

function anchorGeometry(elements: HTMLElement[], layoutRect: DOMRect) {
  const rects = elements.flatMap((element) => {
    const clientRects = [...element.getClientRects()];
    return clientRects.length > 0 ? clientRects : [element.getBoundingClientRect()];
  });
  if (rects.length === 0) return null;
  const top = Math.min(...rects.map((rect) => rect.top)) - layoutRect.top;
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) - layoutRect.top;
  return {
    top,
    right: Math.max(...rects.map((rect) => rect.right)) - layoutRect.left,
    height: Math.max(1, bottom - top),
  };
}

function syncActiveAnchors(root: Element, activeId: string | null) {
  root.querySelectorAll<HTMLElement>("[data-annotation-id]").forEach((element) => {
    element.classList.toggle("is-active", element.dataset.annotationId === activeId);
  });
}

export function AnnotatedEditorLayout({ children, editorRoot, annotations, pendingRetiredAnnotationIds }: {
  children: ReactNode;
  editorRoot: HTMLElement | null;
  annotations: AnnotationCardView[];
  pendingRetiredAnnotationIds: string[];
}) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const activeIdRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [cardTops, setCardTops] = useState<Record<string, number>>({});
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const visibleIds = useMemo(
    () => visibleAnnotationIds(annotations.map((annotation) => annotation.id), pendingRetiredAnnotationIds),
    [annotations, pendingRetiredAnnotationIds],
  );
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => visibleIdSet.has(annotation.id)),
    [annotations, visibleIdSet],
  );
  const resolvedActiveId = activeId && visibleIdSet.has(activeId) ? activeId : null;
  const resolvedSheetId = resolveAnnotationSheetId(sheetId, visibleIds);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (editorRoot) syncActiveAnchors(editorRoot, activeId);
  }, [activeId, editorRoot]);

  const measure = useCallback(() => {
    const layout = layoutRef.current;
    const sidebar = sidebarRef.current;
    if (!layout || !editorRoot || !sidebar || shouldUseAnnotationSheet(window.innerWidth)) {
      setCardTops((current) => Object.keys(current).length === 0 ? current : {});
      setConnectors((current) => current.length === 0 ? current : []);
      setSidebarHeight((current) => current === 0 ? current : 0);
      return;
    }
    const layoutRect = layout.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    const anchors: Array<{ annotationId: string; top: number; right: number; height: number }> = [];
    const cardHeights = new Map<string, number>();
    for (const annotation of visibleAnnotations) {
      const geometry = anchorGeometry(findAnnotationAnchorElements(editorRoot, annotation.id), layoutRect);
      const card = cardRefs.current.get(annotation.id);
      if (!geometry || !card) continue;
      anchors.push({ annotationId: annotation.id, ...geometry });
      cardHeights.set(annotation.id, card.offsetHeight);
    }
    const placement = layoutAnnotationCards(anchors, cardHeights, 12);
    const anchorsById = new Map(anchors.map((anchor) => [anchor.annotationId, anchor]));
    const tops: Record<string, number> = {};
    const nextConnectors: Connector[] = [];
    for (const placed of placement.cards) {
      const anchor = anchorsById.get(placed.annotationId);
      const card = cardRefs.current.get(placed.annotationId);
      if (!anchor || !card) continue;
      tops[placed.annotationId] = placed.top;
      const startX = anchor.right + 7;
      const startY = anchor.top + anchor.height / 2;
      const endX = sidebarRect.left - layoutRect.left - 7;
      const endY = placed.top + Math.min(42, card.offsetHeight / 2);
      const bend = Math.max(18, (endX - startX) * .42);
      nextConnectors.push({ annotationId: placed.annotationId, path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}` });
    }
    setCardTops((current) => sameNumberRecord(current, tops) ? current : tops);
    setConnectors((current) => sameConnectors(current, nextConnectors) ? current : nextConnectors);
    const nextHeight = Math.max(editorRoot.offsetHeight, placement.height);
    setSidebarHeight((current) => current === nextHeight ? current : nextHeight);
  }, [editorRoot, visibleAnnotations]);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const sidebar = sidebarRef.current;
    if (!layout || !sidebar) return;
    const scheduler = createAnnotationLayoutScheduler(measure);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduler.schedule());
    const mutationObserver = editorRoot && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => {
        syncActiveAnchors(editorRoot, activeIdRef.current);
        scheduler.schedule();
      })
      : null;
    resizeObserver?.observe(layout);
    resizeObserver?.observe(sidebar);
    if (editorRoot) resizeObserver?.observe(editorRoot);
    cardRefs.current.forEach((card) => resizeObserver?.observe(card));
    mutationObserver?.observe(editorRoot!, { childList: true, characterData: true, subtree: true });
    const schedule = () => scheduler.schedule();
    window.addEventListener("resize", schedule);
    scheduler.schedule();
    return () => {
      scheduler.destroy();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [editorRoot, measure, visibleAnnotations]);

  useEffect(() => {
    if (!editorRoot) return;
    const activateTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const annotationId = findAnnotationIdFromTarget(editorRoot, target);
      if (annotationId && visibleIdSet.has(annotationId)) setActiveId(annotationId);
      return annotationId;
    };
    const activateFromEvent = (event: Event) => { activateTarget(event.target); };
    const activateFromSelection = () => {
      const selection = document.getSelection();
      const node = selection?.anchorNode;
      if (!node || !editorRoot.contains(node)) return;
      const target = node instanceof Element ? node : node.parentElement;
      const annotationId = findAnnotationIdFromTarget(editorRoot, target);
      setActiveId(annotationId && visibleIdSet.has(annotationId) ? annotationId : null);
    };
    const activateFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const annotationId = activateTarget(event.target);
      if (!annotationId || !visibleIdSet.has(annotationId) || !shouldUseAnnotationSheet(window.innerWidth)) return;
      event.preventDefault();
      setSheetId(annotationId);
    };
    editorRoot.addEventListener("click", activateFromEvent);
    editorRoot.addEventListener("focusin", activateFromEvent);
    editorRoot.addEventListener("pointerover", activateFromEvent);
    editorRoot.addEventListener("keydown", activateFromKeyboard);
    document.addEventListener("selectionchange", activateFromSelection);
    return () => {
      editorRoot.removeEventListener("click", activateFromEvent);
      editorRoot.removeEventListener("focusin", activateFromEvent);
      editorRoot.removeEventListener("pointerover", activateFromEvent);
      editorRoot.removeEventListener("keydown", activateFromKeyboard);
      document.removeEventListener("selectionchange", activateFromSelection);
    };
  }, [editorRoot, visibleIdSet]);

  const locateAnnotation = useCallback((annotationId: string) => {
    if (!editorRoot || !visibleIdSet.has(annotationId)) return;
    const anchor = findAnnotationAnchorElements(editorRoot, annotationId)[0];
    if (!anchor) return;
    setActiveId(annotationId);
    setSheetId(null);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    anchor.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    anchor.focus({ preventScroll: true });
  }, [editorRoot, visibleIdSet]);

  const sheetAnnotation = visibleAnnotations.find((annotation) => annotation.id === resolvedSheetId) ?? null;
  const mobileTargetId = resolvedActiveId ?? visibleIds[0] ?? null;

  return <div className="annotated-editor-layout" ref={layoutRef}>
    <div className="annotated-editor-main">{children}</div>
    <svg className="annotation-connectors" aria-hidden="true">{connectors.map((connector) => <path key={connector.annotationId} d={connector.path} className={resolvedActiveId === connector.annotationId ? "is-active" : ""} />)}</svg>
    <aside ref={sidebarRef} className="annotation-sidebar annotation-editor-sidebar" aria-label={`正文批注，只读，共 ${visibleAnnotations.length} 条`} style={{ minHeight: sidebarHeight || undefined }}>
      {visibleAnnotations.map((annotation) => <article id={`annotation-editor-card-${annotation.id}`} key={annotation.id} ref={(element) => {
        if (element) cardRefs.current.set(annotation.id, element);
        else cardRefs.current.delete(annotation.id);
      }} className={`annotation-card${resolvedActiveId === annotation.id ? " is-active" : ""}`} style={{ top: cardTops[annotation.id] ?? 0 }} tabIndex={-1} onFocusCapture={() => setActiveId(annotation.id)} onPointerEnter={() => setActiveId(annotation.id)}>
        <AnnotationReadonlyThread annotation={annotation} onLocate={() => locateAnnotation(annotation.id)} />
      </article>)}
    </aside>
    {mobileTargetId && <button type="button" className="annotation-editor-sheet-trigger" onClick={() => setSheetId(mobileTargetId)}>
      {resolvedActiveId === mobileTargetId ? "查看当前批注" : `查看正文批注（${visibleAnnotations.length}）`}
    </button>}
    <AnnotationSheet annotation={sheetAnnotation} open={Boolean(resolvedSheetId)} onClose={() => setSheetId(null)} onLocate={() => sheetAnnotation && locateAnnotation(sheetAnnotation.id)} readOnly />
  </div>;
}
