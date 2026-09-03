"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AnnotationActionState } from "@/app/(site)/posts/[id]/actions";
import { AnnotationSheet } from "@/components/annotations/annotation-sheet";
import { AnnotationThread, type AnnotationCardView, type AnnotationDeleteAction, type AnnotationRemoveImportedAction, type AnnotationReplyAction, type AnnotationReplyDeleteAction } from "@/components/annotations/annotation-thread";
import { LazyMarkdownEditor } from "@/components/editor/lazy-markdown-editor";
import { ModalDialog } from "@/components/modal-dialog";
import { isBlockingAccessError } from "@/lib/actions/result";
import { describeAnnotationDomRange } from "@/lib/annotations/dom-selection";
import {
  annotationAnchorGeometry,
  annotationConnectorPath,
  createAnnotationLayoutScheduler,
  findAnnotationAnchorElements,
  layoutAnnotationCards,
  sameAnnotationCardTops,
  sameAnnotationConnectors,
  type AnnotationConnector,
} from "@/lib/annotations/layout";
import { annotationLayoutMode, nextAnnotationSheetState, type AnnotationLayoutMode } from "@/lib/annotations/responsive";
import {
  captureSavedAnnotationSelection,
  nextSelectionPreviewPhase,
  paintAnnotationSelectionPreview,
  validateSavedAnnotationSelection,
  type SavedAnnotationSelection,
  type SelectionPreviewEvent,
  type SelectionPreviewPhase,
} from "@/lib/annotations/selection-preview";

type AnnotationAction = (state: AnnotationActionState, formData: FormData) => Promise<AnnotationActionState>;
export type { AnnotationCardView } from "./annotation-thread";
type SelectionContext = { saved: SavedAnnotationSelection; left: number; top: number; phase: SelectionPreviewPhase; submissionKey: string };
const nestedInteractiveSelector = "a[href], button, input, textarea, select, summary, [contenteditable='true']";

function isNestedInteractiveTarget(target: Element, anchor: HTMLElement): boolean {
  const interactive = target.closest<HTMLElement>(nestedInteractiveSelector);
  return Boolean(interactive && interactive !== anchor);
}

function AnnotationComposer({ action, savedSelection, submissionKey, validateSelection, onPhaseChange, onClose, onSuccess }: {
  action: AnnotationAction;
  savedSelection: SavedAnnotationSelection;
  submissionKey: string;
  validateSelection: () => boolean;
  onPhaseChange: (event: SelectionPreviewEvent) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [markdown, setMarkdown] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const handledSuccessRef = useRef<string | null>(null);
  const accessBlocked = isBlockingAccessError(state.code);
  const onPhaseChangeRef = useRef(onPhaseChange);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onPhaseChangeRef.current = onPhaseChange;
    onSuccessRef.current = onSuccess;
  }, [onPhaseChange, onSuccess]);
  useEffect(() => {
    if (pending) return;
    if (state.annotationId && handledSuccessRef.current !== state.annotationId) {
      handledSuccessRef.current = state.annotationId;
      onPhaseChangeRef.current("submit-succeeded");
      onSuccessRef.current();
    } else if (state.error) {
      onPhaseChangeRef.current("failure");
    }
  }, [pending, state.annotationId, state.error]);
  return <ModalDialog open title="添加正文批注" description="批注发布后不能编辑；写错时可以删除或回复补充。" onClose={() => { if (!pending) onClose(); }}>
    <form action={formAction} className="annotation-composer" noValidate onSubmit={(event) => {
      if (!validateSelection()) {
        event.preventDefault();
        setClientError("正文或选区已经变化，请重新选择文字");
        onPhaseChange("invalidate");
        return;
      }
      setClientError(null);
      onPhaseChange(state.error ? "retry" : "submit");
    }}>
      <input type="hidden" name="baseRevisionId" value={savedSelection.baseRevisionId} />
      <input type="hidden" name="selection" value={JSON.stringify(savedSelection.descriptor)} />
      <input type="hidden" name="contentMarkdown" value={markdown} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <blockquote className="annotation-selection-preview">{savedSelection.selectedText}</blockquote>
      <LazyMarkdownEditor initialMarkdown="" onMarkdownChange={setMarkdown} onEditorRootChange={(root) => {
        if (root) window.requestAnimationFrame(() => root.querySelector<HTMLElement>(".ProseMirror")?.focus());
      }} compact disabled={pending || accessBlocked} />
      {(clientError || state.error) && <p className="form-error" role="alert">{clientError ?? state.error}</p>}
      <div className="dialog-actions"><button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>取消</button><button className="button button--primary" disabled={pending || accessBlocked || !markdown.trim()} aria-busy={pending}>{pending ? "发布中…" : "发布批注"}</button></div>
    </form>
  </ModalDialog>;
}

export function AnnotationReadingLayout({ postId, html, annotations, baseRevisionId, action, replyAction, deleteAction, deleteReplyAction, removeImportedAction, initialAnnotationId, initialAnnotationReplyId }: {
  postId: string; html: string; annotations: AnnotationCardView[]; baseRevisionId: string; action: AnnotationAction; replyAction: AnnotationReplyAction;
  deleteAction: AnnotationDeleteAction; deleteReplyAction: AnnotationReplyDeleteAction; removeImportedAction: AnnotationRemoveImportedAction; initialAnnotationId?: string; initialAnnotationReplyId?: string;
}) {
  const router = useRouter();
  const layoutRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const documentEpochRef = useRef(0);
  const [activeId, setActiveId] = useState<string | null>(initialAnnotationId ?? null);
  const [selectionContext, setSelectionContext] = useState<SelectionContext | null>(null);
  const [cardTops, setCardTops] = useState<Record<string, number>>({});
  const [connectors, setConnectors] = useState<AnnotationConnector[]>([]);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<AnnotationLayoutMode>("compact");
  const [deepLinkHighlight, setDeepLinkHighlight] = useState<{ annotationId: string; replyId: string | null } | null>(null);
  const currentSelectionContext = selectionContext?.saved.postId === postId && selectionContext.saved.baseRevisionId === baseRevisionId ? selectionContext : null;
  const previewSelection = currentSelectionContext && currentSelectionContext.phase !== "hidden" ? currentSelectionContext.saved : null;

  const transitionSelectionPreview = useCallback((event: SelectionPreviewEvent) => {
    setSelectionContext((current) => current ? { ...current, phase: nextSelectionPreviewPhase(current.phase, event) } : current);
  }, []);

  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root || !previewSelection) return;
    const range = validateSavedAnnotationSelection(previewSelection, { postId, baseRevisionId, root, epoch: documentEpochRef.current });
    if (!range) return;
    return paintAnnotationSelectionPreview(range);
  }, [baseRevisionId, postId, previewSelection]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      documentEpochRef.current += 1;
      setSelectionContext(null);
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const measure = useCallback(() => {
    const layout = layoutRef.current; const body = bodyRef.current; const sidebar = sidebarRef.current;
    if (!layout || !body || !sidebar) return;
    const nextLayoutMode = annotationLayoutMode(layout.clientWidth);
    if (nextLayoutMode !== layoutMode) {
      setLayoutMode(nextLayoutMode);
      if (nextLayoutMode === "desktop") setSheetId(null);
      return;
    }
    if (layoutMode === "compact") {
      setConnectors((current) => current.length === 0 ? current : []);
      setCardTops((current) => Object.keys(current).length === 0 ? current : {});
      setSidebarHeight((current) => current === 0 ? current : 0);
      return;
    }
    const layoutRect = layout.getBoundingClientRect(); const bodyRect = body.getBoundingClientRect(); const sidebarRect = sidebar.getBoundingClientRect();
    const anchors: Array<{ annotationId: string; top: number; right: number; height: number }> = [];
    const cardHeights = new Map<string, number>();
    for (const annotation of annotations) {
      const anchorElements = findAnnotationAnchorElements(body, annotation.id);
      const card = cardRefs.current.get(annotation.id);
      if (anchorElements.length === 0 || !card) continue;
      const clientRects = anchorElements.flatMap((anchor) => {
        const rects = [...anchor.getClientRects()];
        return rects.length > 0 ? rects : [anchor.getBoundingClientRect()];
      });
      const geometry = annotationAnchorGeometry(clientRects, layoutRect);
      if (!geometry) continue;
      anchors.push({ annotationId: annotation.id, ...geometry });
      cardHeights.set(annotation.id, card.offsetHeight);
    }
    const placement = layoutAnnotationCards(anchors, cardHeights, 12);
    const byId = new Map(anchors.map((anchor) => [anchor.annotationId, anchor]));
    const tops: Record<string, number> = {}; const paths: AnnotationConnector[] = [];
    for (const placed of placement.cards) {
      const anchor = byId.get(placed.annotationId); const card = cardRefs.current.get(placed.annotationId);
      if (!anchor || !card) continue;
      tops[placed.annotationId] = placed.top;
      const startX = bodyRect.right - layoutRect.left + 8; const startY = anchor.top + anchor.height / 2;
      const endX = sidebarRect.left - layoutRect.left - 7; const endY = placed.top + Math.min(42, card.offsetHeight / 2);
      paths.push({ annotationId: placed.annotationId, path: annotationConnectorPath({ startX, startY, endX, endY }) });
    }
    setCardTops((current) => sameAnnotationCardTops(current, tops) ? current : tops);
    setConnectors((current) => sameAnnotationConnectors(current, paths) ? current : paths);
    const nextSidebarHeight = Math.max(body.offsetHeight, placement.height);
    setSidebarHeight((current) => current === nextSidebarHeight ? current : nextSidebarHeight);
  }, [annotations, layoutMode]);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const body = bodyRef.current;
    const sidebar = sidebarRef.current;
    const scheduler = createAnnotationLayoutScheduler(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduler.schedule());
    if (layout) observer?.observe(layout); if (body) observer?.observe(body); if (sidebar) observer?.observe(sidebar); cardRefs.current.forEach((card) => observer?.observe(card));
    const schedule = () => scheduler.schedule();
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) schedule(); });
    body?.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule); scheduler.schedule();
    return () => { cancelled = true; scheduler.destroy(); observer?.disconnect(); body?.removeEventListener("load", schedule, true); window.removeEventListener("resize", schedule); };
  }, [measure]);

  useEffect(() => {
    if (!initialAnnotationId) return;
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      const anchor = bodyRef.current ? findAnnotationAnchorElements(bodyRef.current, initialAnnotationId)[0] : null;
      const annotation = annotations.find((item) => item.id === initialAnnotationId);
      if (!anchor || !annotation) return;
      const replyAvailable = !initialAnnotationReplyId || annotation.replies.some((reply) => reply.id === initialAnnotationReplyId);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setActiveId(initialAnnotationId);
      anchor.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
      anchor.focus({ preventScroll: true });
      if (layoutMode === "compact") setSheetId(initialAnnotationId);
      nestedFrame = window.requestAnimationFrame(() => {
        const targetId = initialAnnotationReplyId && replyAvailable
          ? `annotation-reply-${initialAnnotationReplyId}`
          : layoutMode === "desktop" ? `annotation-card-${initialAnnotationId}` : null;
        const target = targetId ? document.getElementById(targetId) : null;
        target?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
        target?.focus({ preventScroll: true });
        setDeepLinkHighlight({ annotationId: initialAnnotationId, replyId: initialAnnotationReplyId && replyAvailable ? initialAnnotationReplyId : null });
      });
    });
    return () => { window.cancelAnimationFrame(frame); window.cancelAnimationFrame(nestedFrame); };
  }, [annotations, initialAnnotationId, initialAnnotationReplyId, layoutMode]);

  useEffect(() => {
    if (!deepLinkHighlight) return;
    const timeout = window.setTimeout(() => setDeepLinkHighlight(null), 2_000);
    return () => window.clearTimeout(timeout);
  }, [deepLinkHighlight]);

  useEffect(() => {
    const body = bodyRef.current; if (!body) return;
    body.querySelectorAll(".annotation-range.is-active, .annotation-range.is-deep-linked").forEach((element) => element.classList.remove("is-active", "is-deep-linked"));
    if (activeId) findAnnotationAnchorElements(body, activeId).forEach((element) => element.classList.add("is-active"));
    if (deepLinkHighlight) findAnnotationAnchorElements(body, deepLinkHighlight.annotationId).forEach((element) => element.classList.add("is-deep-linked"));
  }, [activeId, deepLinkHighlight]);

  const inspectSelection = useCallback((eventTarget?: EventTarget | null) => {
    const root = bodyRef.current; const selection = window.getSelection();
    if (!root) return;
    if (eventTarget instanceof Node && !root.contains(eventTarget)) return;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) { setSelectionContext(null); return; }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const existing = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>(".annotation-range");
    if (existing?.dataset.annotationId) {
      setActiveId(existing.dataset.annotationId); setSheetId((current) => nextAnnotationSheetState(current, { type: "activate", annotationId: existing.dataset.annotationId!, compact: layoutMode === "compact" })); setSelectionContext(null); return;
    }
    try {
      const descriptor = describeAnnotationDomRange(root, range);
      const rects = [...range.getClientRects()].filter((candidate) => candidate.width > 0 && candidate.height > 0);
      const rect = rects.at(-1) ?? range.getBoundingClientRect();
      const saved = captureSavedAnnotationSelection({ postId, baseRevisionId, descriptor, root, range, epoch: documentEpochRef.current });
      setSelectionContext({ saved, left: Math.min(window.innerWidth - 118, Math.max(12, rect.left + rect.width / 2 - 50)), top: Math.max(12, rect.top - 44), phase: nextSelectionPreviewPhase("hidden", "capture"), submissionKey: crypto.randomUUID() });
    } catch { setSelectionContext(null); }
  }, [baseRevisionId, layoutMode, postId]);

  useEffect(() => {
    const schedule = (event: Event) => { const target = event.target; window.setTimeout(() => inspectSelection(target), 0); };
    document.addEventListener("pointerup", schedule); document.addEventListener("keyup", schedule);
    return () => { document.removeEventListener("pointerup", schedule); document.removeEventListener("keyup", schedule); };
  }, [inspectSelection]);

  const validateCurrentSelection = useCallback((saved: SavedAnnotationSelection) => {
    const root = bodyRef.current;
    return Boolean(root && validateSavedAnnotationSelection(saved, { postId, baseRevisionId, root, epoch: documentEpochRef.current }));
  }, [baseRevisionId, postId]);

  const cancelSelectionContext = useCallback(() => {
    const root = bodyRef.current;
    const saved = currentSelectionContext?.saved;
    const range = root && saved ? validateSavedAnnotationSelection(saved, { postId, baseRevisionId, root, epoch: documentEpochRef.current }) : null;
    transitionSelectionPreview("cancel");
    setSelectionContext(null);
    if (!root || !range) return;
    window.requestAnimationFrame(() => {
      root.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, [baseRevisionId, currentSelectionContext?.saved, postId, transitionSelectionPreview]);

  const activateFromBody = (target: EventTarget | null, openSheet = false) => {
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLElement>(".annotation-range"); const id = anchor?.dataset.annotationId; if (!id) return;
    setActiveId(id);
    if (openSheet && anchor && !isNestedInteractiveTarget(target, anchor)) setSheetId((current) => nextAnnotationSheetState(current, { type: "activate", annotationId: id, compact: layoutMode === "compact" }));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRefs.current.get(id)?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  };

  return <div className={`annotation-reading-layout${annotations.length === 0 ? " annotation-reading-layout--empty" : ""}`} data-annotation-layout={layoutMode} ref={layoutRef}>
    <div ref={bodyRef} className="markdown-body annotation-document-body" tabIndex={-1}
      onClick={(event) => { const target = event.target instanceof Element ? event.target : null; const anchor = target?.closest<HTMLElement>(".annotation-range"); if (target && anchor && !isNestedInteractiveTarget(target, anchor) && layoutMode === "compact") event.preventDefault(); activateFromBody(event.target, true); }}
      onFocus={(event) => activateFromBody(event.target)} onPointerOver={(event) => activateFromBody(event.target)}
      onKeyDown={(event) => { const target = event.target instanceof Element ? event.target : null; const anchor = target?.closest<HTMLElement>(".annotation-range"); if (target === anchor && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activateFromBody(event.target, true); } }}
      dangerouslySetInnerHTML={{ __html: html }} />
    <svg className="annotation-connectors" aria-hidden="true">{connectors.map((connector) => <path key={connector.annotationId} d={connector.path} className={activeId === connector.annotationId ? "is-active" : ""} />)}</svg>
    <aside ref={sidebarRef} className="annotation-sidebar" aria-label={`正文批注，共 ${annotations.length} 条`} style={{ minHeight: sidebarHeight || undefined }}>
      {layoutMode === "desktop" && annotations.map((annotation) => <article id={`annotation-card-${annotation.id}`} key={annotation.id} ref={(element) => { if (element) cardRefs.current.set(annotation.id, element); else cardRefs.current.delete(annotation.id); }} className={`annotation-card${activeId === annotation.id ? " is-active" : ""}${deepLinkHighlight?.annotationId === annotation.id && !deepLinkHighlight.replyId ? " is-deep-linked" : ""}`} style={{ top: cardTops[annotation.id] ?? 0 }} tabIndex={-1} onFocusCapture={() => setActiveId(annotation.id)} onPointerEnter={() => setActiveId(annotation.id)}>
        <AnnotationThread annotation={annotation} replyAction={replyAction} deleteAction={deleteAction} deleteReplyAction={deleteReplyAction} removeImportedAction={removeImportedAction} highlightReplyId={deepLinkHighlight?.annotationId === annotation.id ? deepLinkHighlight.replyId : null} onLocate={() => { setActiveId(annotation.id); const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; if (bodyRef.current) findAnnotationAnchorElements(bodyRef.current, annotation.id)[0]?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" }); }} />
      </article>)}
    </aside>
    <AnnotationSheet annotation={annotations.find((annotation) => annotation.id === sheetId) ?? null} open={Boolean(sheetId)} onClose={() => setSheetId((current) => nextAnnotationSheetState(current, { type: "close" }))} replyAction={replyAction} deleteAction={deleteAction} deleteReplyAction={deleteReplyAction} removeImportedAction={removeImportedAction} highlightReplyId={deepLinkHighlight?.annotationId === sheetId ? deepLinkHighlight.replyId : null} highlighted={deepLinkHighlight?.annotationId === sheetId && !deepLinkHighlight.replyId} />
    {currentSelectionContext?.phase === "bubble" && <button type="button" className="annotation-selection-menu" style={{ left: currentSelectionContext.left, top: currentSelectionContext.top }} onPointerDown={(event) => event.preventDefault()} onClick={() => transitionSelectionPreview("open-composer")}>添加批注</button>}
    {currentSelectionContext && ["composer", "pending", "failed"].includes(currentSelectionContext.phase) && <AnnotationComposer
      key={currentSelectionContext.submissionKey}
      action={action}
      savedSelection={currentSelectionContext.saved}
      submissionKey={currentSelectionContext.submissionKey}
      validateSelection={() => validateCurrentSelection(currentSelectionContext.saved)}
      onPhaseChange={transitionSelectionPreview}
      onClose={cancelSelectionContext}
      onSuccess={() => router.refresh()}
    />}
  </div>;
}
