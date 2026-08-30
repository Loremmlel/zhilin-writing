"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AnnotationActionState } from "@/app/(site)/posts/[id]/actions";
import { AnnotationSheet } from "@/components/annotations/annotation-sheet";
import { AnnotationThread, type AnnotationCardView, type AnnotationDeleteAction, type AnnotationRemoveImportedAction, type AnnotationReplyAction, type AnnotationReplyDeleteAction } from "@/components/annotations/annotation-thread";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { ModalDialog } from "@/components/modal-dialog";
import { describeAnnotationDomRange } from "@/lib/annotations/dom-selection";
import { layoutAnnotationCards } from "@/lib/annotations/layout";
import { nextAnnotationSheetState, shouldUseAnnotationSheet } from "@/lib/annotations/responsive";
import type { AnnotationSelectionDescriptor } from "@/lib/annotations/types";

type AnnotationAction = (state: AnnotationActionState, formData: FormData) => Promise<AnnotationActionState>;
export type { AnnotationCardView } from "./annotation-thread";
type FloatingSelection = { descriptor: AnnotationSelectionDescriptor; left: number; top: number };
type Connector = { annotationId: string; path: string };
const nestedInteractiveSelector = "a[href], button, input, textarea, select, summary, [contenteditable='true']";

function isNestedInteractiveTarget(target: Element, anchor: HTMLElement): boolean {
  const interactive = target.closest<HTMLElement>(nestedInteractiveSelector);
  return Boolean(interactive && interactive !== anchor);
}

function AnnotationComposer({ action, baseRevisionId, selection, submissionKey, onClose }: {
  action: AnnotationAction; baseRevisionId: string; selection: AnnotationSelectionDescriptor; submissionKey: string; onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [markdown, setMarkdown] = useState("");
  useEffect(() => { if (state.annotationId) { onClose(); router.refresh(); } }, [onClose, router, state.annotationId]);
  return <ModalDialog open title="添加正文批注" description="批注发布后不能编辑；写错时可以删除或回复补充。" onClose={onClose}>
    <form action={formAction} className="annotation-composer" noValidate>
      <input type="hidden" name="baseRevisionId" value={baseRevisionId} />
      <input type="hidden" name="selection" value={JSON.stringify(selection)} />
      <input type="hidden" name="contentMarkdown" value={markdown} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <blockquote className="annotation-selection-preview">{selection.selectedText}</blockquote>
      <MarkdownEditor initialMarkdown="" onMarkdownChange={setMarkdown} compact />
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <div className="dialog-actions"><button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>取消</button><button className="button button--primary" disabled={pending || !markdown.trim()} aria-busy={pending}>{pending ? "发布中…" : "发布批注"}</button></div>
    </form>
  </ModalDialog>;
}

export function AnnotationReadingLayout({ html, annotations, baseRevisionId, action, replyAction, deleteAction, deleteReplyAction, removeImportedAction, initialAnnotationId }: {
  html: string; annotations: AnnotationCardView[]; baseRevisionId: string; action: AnnotationAction; replyAction: AnnotationReplyAction;
  deleteAction: AnnotationDeleteAction; deleteReplyAction: AnnotationReplyDeleteAction; removeImportedAction: AnnotationRemoveImportedAction; initialAnnotationId?: string;
}) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [activeId, setActiveId] = useState<string | null>(initialAnnotationId ?? null);
  const [floating, setFloating] = useState<FloatingSelection | null>(null);
  const [composer, setComposer] = useState<{ selection: AnnotationSelectionDescriptor; submissionKey: string } | null>(null);
  const [cardTops, setCardTops] = useState<Record<string, number>>({});
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const measure = useCallback(() => {
    const layout = layoutRef.current; const body = bodyRef.current; const sidebar = sidebarRef.current;
    if (!layout || !body || !sidebar || window.matchMedia("(max-width: 900px)").matches) { setConnectors([]); setCardTops({}); setSidebarHeight(0); return; }
    const layoutRect = layout.getBoundingClientRect(); const sidebarRect = sidebar.getBoundingClientRect();
    const anchors: Array<{ annotationId: string; top: number; right: number; height: number }> = [];
    const cardHeights = new Map<string, number>();
    for (const annotation of annotations) {
      const anchor = body.querySelector<HTMLElement>(`.annotation-range[data-annotation-id="${CSS.escape(annotation.id)}"]`);
      const card = cardRefs.current.get(annotation.id);
      if (!anchor || !card) continue;
      const rect = anchor.getBoundingClientRect();
      anchors.push({ annotationId: annotation.id, top: rect.top - layoutRect.top, right: rect.right - layoutRect.left, height: rect.height });
      cardHeights.set(annotation.id, card.offsetHeight);
    }
    const placement = layoutAnnotationCards(anchors, cardHeights, 12);
    const byId = new Map(anchors.map((anchor) => [anchor.annotationId, anchor]));
    const tops: Record<string, number> = {}; const paths: Connector[] = [];
    for (const placed of placement.cards) {
      const anchor = byId.get(placed.annotationId); const card = cardRefs.current.get(placed.annotationId);
      if (!anchor || !card) continue;
      tops[placed.annotationId] = placed.top;
      const startX = anchor.right + 7; const startY = anchor.top + anchor.height / 2;
      const endX = sidebarRect.left - layoutRect.left - 7; const endY = placed.top + Math.min(42, card.offsetHeight / 2);
      const bend = Math.max(18, (endX - startX) * .42);
      paths.push({ annotationId: placed.annotationId, path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}` });
    }
    setCardTops(tops); setConnectors(paths); setSidebarHeight(Math.max(body.offsetHeight, placement.height));
  }, [annotations]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(measure); const observer = new ResizeObserver(measure);
    if (layoutRef.current) observer.observe(layoutRef.current); if (bodyRef.current) observer.observe(bodyRef.current); cardRefs.current.forEach((card) => observer.observe(card));
    window.addEventListener("resize", measure);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure]);

  useEffect(() => {
    if (!initialAnnotationId) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = bodyRef.current?.querySelector<HTMLElement>(`.annotation-range[data-annotation-id="${CSS.escape(initialAnnotationId)}"]`);
      anchor?.scrollIntoView({ block: "center" }); anchor?.focus({ preventScroll: true });
      if (shouldUseAnnotationSheet(window.innerWidth) && annotations.some((annotation) => annotation.id === initialAnnotationId)) setSheetId(initialAnnotationId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [annotations, initialAnnotationId]);

  useEffect(() => { if (!sheetId) return; const resize = () => { if (!shouldUseAnnotationSheet(window.innerWidth)) setSheetId(null); }; window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, [sheetId]);
  useEffect(() => {
    const body = bodyRef.current; if (!body) return;
    body.querySelectorAll(".annotation-range.is-active").forEach((element) => element.classList.remove("is-active"));
    if (activeId) body.querySelector<HTMLElement>(`.annotation-range[data-annotation-id="${CSS.escape(activeId)}"]`)?.classList.add("is-active");
  }, [activeId]);

  const inspectSelection = useCallback(() => {
    const root = bodyRef.current; const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) { setFloating(null); return; }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) { setFloating(null); return; }
    const existing = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>(".annotation-range");
    if (existing?.dataset.annotationId) {
      setActiveId(existing.dataset.annotationId); setSheetId((current) => nextAnnotationSheetState(current, { type: "activate", annotationId: existing.dataset.annotationId!, compact: shouldUseAnnotationSheet(window.innerWidth) })); setFloating(null); return;
    }
    try {
      const descriptor = describeAnnotationDomRange(root, range); const rect = range.getBoundingClientRect();
      setFloating({ descriptor, left: Math.min(window.innerWidth - 118, Math.max(12, rect.left + rect.width / 2 - 50)), top: Math.max(12, rect.top - 44) });
    } catch { setFloating(null); }
  }, []);

  useEffect(() => { const schedule = () => window.setTimeout(inspectSelection, 0); document.addEventListener("pointerup", schedule); document.addEventListener("keyup", schedule); return () => { document.removeEventListener("pointerup", schedule); document.removeEventListener("keyup", schedule); }; }, [inspectSelection]);

  const activateFromBody = (target: EventTarget | null, openSheet = false) => {
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLElement>(".annotation-range"); const id = anchor?.dataset.annotationId; if (!id) return;
    setActiveId(id);
    if (openSheet && anchor && !isNestedInteractiveTarget(target, anchor)) setSheetId((current) => nextAnnotationSheetState(current, { type: "activate", annotationId: id, compact: shouldUseAnnotationSheet(window.innerWidth) }));
    cardRefs.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return <div className={`annotation-reading-layout${annotations.length === 0 ? " annotation-reading-layout--empty" : ""}`} ref={layoutRef}>
    <div ref={bodyRef} className="markdown-body annotation-document-body"
      onClick={(event) => { const target = event.target instanceof Element ? event.target : null; const anchor = target?.closest<HTMLElement>(".annotation-range"); if (target && anchor && !isNestedInteractiveTarget(target, anchor) && shouldUseAnnotationSheet(window.innerWidth)) event.preventDefault(); activateFromBody(event.target, true); }}
      onFocus={(event) => activateFromBody(event.target)} onPointerOver={(event) => activateFromBody(event.target)}
      onKeyDown={(event) => { const target = event.target instanceof Element ? event.target : null; const anchor = target?.closest<HTMLElement>(".annotation-range"); if (target === anchor && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activateFromBody(event.target, true); } }}
      dangerouslySetInnerHTML={{ __html: html }} />
    <svg className="annotation-connectors" aria-hidden="true">{connectors.map((connector) => <path key={connector.annotationId} d={connector.path} className={activeId === connector.annotationId ? "is-active" : ""} />)}</svg>
    <aside ref={sidebarRef} className="annotation-sidebar" aria-label={`正文批注，共 ${annotations.length} 条`} style={{ minHeight: sidebarHeight || undefined }}>
      {annotations.map((annotation) => <article id={`annotation-card-${annotation.id}`} key={annotation.id} ref={(element) => { if (element) cardRefs.current.set(annotation.id, element); else cardRefs.current.delete(annotation.id); }} className={`annotation-card${activeId === annotation.id ? " is-active" : ""}`} style={{ top: cardTops[annotation.id] ?? 0 }} tabIndex={-1} onFocusCapture={() => setActiveId(annotation.id)} onPointerEnter={() => setActiveId(annotation.id)}>
        <AnnotationThread annotation={annotation} replyAction={replyAction} deleteAction={deleteAction} deleteReplyAction={deleteReplyAction} removeImportedAction={removeImportedAction} onLocate={() => { setActiveId(annotation.id); bodyRef.current?.querySelector<HTMLElement>(`.annotation-range[data-annotation-id="${CSS.escape(annotation.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }} />
      </article>)}
    </aside>
    <AnnotationSheet annotation={annotations.find((annotation) => annotation.id === sheetId) ?? null} open={Boolean(sheetId)} onClose={() => setSheetId((current) => nextAnnotationSheetState(current, { type: "close" }))} replyAction={replyAction} deleteAction={deleteAction} deleteReplyAction={deleteReplyAction} removeImportedAction={removeImportedAction} />
    {floating && <button type="button" className="annotation-selection-menu" style={{ left: floating.left, top: floating.top }} onPointerDown={(event) => event.preventDefault()} onClick={() => { setComposer({ selection: floating.descriptor, submissionKey: crypto.randomUUID() }); setFloating(null); }}>添加批注</button>}
    {composer && <AnnotationComposer key={composer.submissionKey} action={action} baseRevisionId={baseRevisionId} selection={composer.selection} submissionKey={composer.submissionKey} onClose={() => setComposer(null)} />}
  </div>;
}
