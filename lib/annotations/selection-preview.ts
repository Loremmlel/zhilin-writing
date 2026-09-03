import {
  describeAnnotationDomRange,
  restoreSerializedDomRange,
  serializeDomRange,
  type SerializedDomRange,
} from "./dom-selection.ts";
import type { AnnotationSelectionDescriptor } from "./types.ts";

export type SavedAnnotationSelection = {
  postId: string;
  baseRevisionId: string;
  selectedText: string;
  descriptor: AnnotationSelectionDescriptor;
  domRange: SerializedDomRange;
  epoch: number;
};

export type SelectionPreviewPhase =
  "hidden" | "bubble" | "composer" | "pending" | "failed" | "awaiting-annotation";
export type SelectionPreviewEvent =
  | "capture"
  | "open-composer"
  | "submit"
  | "failure"
  | "retry"
  | "submit-succeeded"
  | "annotation-present"
  | "cancel"
  | "body-click"
  | "invalidate"
  | "revision-change"
  | "unmount";

function sameDescriptor(left: AnnotationSelectionDescriptor, right: AnnotationSelectionDescriptor) {
  return (
    left.blockOrdinal === right.blockOrdinal &&
    left.endBlockOrdinal === right.endBlockOrdinal &&
    left.blockTextFrom === right.blockTextFrom &&
    left.blockTextTo === right.blockTextTo &&
    left.selectedText === right.selectedText
  );
}

export function captureSavedAnnotationSelection(input: {
  postId: string;
  baseRevisionId: string;
  descriptor: AnnotationSelectionDescriptor;
  root: Element;
  range: Range;
  epoch: number;
}): SavedAnnotationSelection {
  return {
    postId: input.postId,
    baseRevisionId: input.baseRevisionId,
    selectedText: input.descriptor.selectedText,
    descriptor: { ...input.descriptor },
    domRange: serializeDomRange(input.root, input.range),
    epoch: input.epoch,
  };
}

export function validateSavedAnnotationSelection(
  saved: SavedAnnotationSelection,
  current: {
    postId: string;
    baseRevisionId: string;
    root: Element;
    epoch: number;
  },
): Range | null {
  if (
    saved.postId !== current.postId ||
    saved.baseRevisionId !== current.baseRevisionId ||
    saved.epoch !== current.epoch
  )
    return null;
  const range = restoreSerializedDomRange(current.root, saved.domRange);
  if (!range) return null;
  try {
    const descriptor = describeAnnotationDomRange(current.root, range);
    return descriptor.selectedText === saved.selectedText &&
      sameDescriptor(descriptor, saved.descriptor)
      ? range
      : null;
  } catch {
    return null;
  }
}

export function nextSelectionPreviewPhase(
  current: SelectionPreviewPhase,
  event: SelectionPreviewEvent,
): SelectionPreviewPhase {
  if (
    [
      "annotation-present",
      "cancel",
      "body-click",
      "invalidate",
      "revision-change",
      "unmount",
    ].includes(event)
  )
    return "hidden";
  if (event === "capture") return "bubble";
  if (event === "open-composer") return current === "hidden" ? "hidden" : "composer";
  if (event === "submit" || event === "retry") return current === "hidden" ? "hidden" : "pending";
  if (event === "failure") return current === "hidden" ? "hidden" : "failed";
  if (event === "submit-succeeded") return current === "hidden" ? "hidden" : "awaiting-annotation";
  return current;
}

type HighlightRegistry = {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
};
type HighlightConstructor = new (...ranges: Range[]) => unknown;
const highlightName = "annotation-selection-preview";
const highlightStyleId = "annotation-selection-preview-style";

function ensureHighlightStyle(ownerDocument: Document) {
  if (ownerDocument.getElementById(highlightStyleId)) return true;
  const style = ownerDocument.createElement("style");
  style.id = highlightStyleId;
  ownerDocument.head.appendChild(style);
  try {
    if (!style.sheet) throw new Error("Highlight stylesheet unavailable");
    style.sheet.insertRule(
      `::highlight(${highlightName}) { background: var(--annotation-active); text-decoration: underline dotted var(--annotation-ink); text-underline-offset: 3px; }`,
    );
    style.sheet.insertRule(
      `@media (forced-colors: active) { ::highlight(${highlightName}) { background: Highlight; color: HighlightText; text-decoration-color: HighlightText; } }`,
    );
    return true;
  } catch {
    style.remove();
    return false;
  }
}

export function paintAnnotationSelectionPreview(range: Range): () => void {
  const ownerDocument = range.startContainer.ownerDocument;
  if (!ownerDocument) return () => undefined;
  const cssHighlights = (
    globalThis.CSS as (typeof CSS & { highlights?: HighlightRegistry }) | undefined
  )?.highlights;
  const HighlightClass = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor })
    .Highlight;
  if (cssHighlights && HighlightClass && ensureHighlightStyle(ownerDocument)) {
    cssHighlights.set(highlightName, new HighlightClass(range));
    return () => cssHighlights.delete(highlightName);
  }

  const view = ownerDocument.defaultView;
  const overlay = ownerDocument.createElement("div");
  overlay.className = "annotation-selection-overlay";
  overlay.setAttribute("aria-hidden", "true");
  ownerDocument.body.appendChild(overlay);
  let frameId: number | null = null;
  let disposed = false;

  const draw = () => {
    frameId = null;
    if (disposed) return;
    const rectangles = [...range.getClientRects()];
    overlay.replaceChildren(
      ...rectangles.map((rectangle) => {
        const marker = ownerDocument.createElement("span");
        marker.className = "annotation-selection-overlay-rect";
        marker.style.left = `${rectangle.left}px`;
        marker.style.top = `${rectangle.top}px`;
        marker.style.width = `${Math.max(1, rectangle.width)}px`;
        marker.style.height = `${Math.max(1, rectangle.height)}px`;
        return marker;
      }),
    );
  };
  const schedule = () => {
    if (disposed || frameId !== null) return;
    if (view) frameId = view.requestAnimationFrame(draw);
    else draw();
  };
  draw();
  view?.addEventListener("resize", schedule);
  ownerDocument.addEventListener("scroll", schedule, true);
  return () => {
    disposed = true;
    if (frameId !== null && view) view.cancelAnimationFrame(frameId);
    view?.removeEventListener("resize", schedule);
    ownerDocument.removeEventListener("scroll", schedule, true);
    overlay.remove();
  };
}
