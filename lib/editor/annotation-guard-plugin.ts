import { Plugin } from "@milkdown/kit/prose/state";
import { undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { inheritDestinationAnnotationMark, stripAnnotationMarksFromSlice } from "./annotation-clipboard.ts";
import { analyzeAnnotationRanges } from "./annotation-ranges.ts";
import {
  createAnnotationGuardSession,
  type AnnotationConfirmationResult,
  type PendingAnnotationImpact,
} from "./annotation-session.ts";

type AnnotationGuardPluginOptions = {
  baseAnnotationIds: string[];
  initialConfirmedAnnotationDeletionIds?: string[];
  onPendingImpact?: (pending: PendingAnnotationImpact) => void;
  onStateChange?: (state: { pending: PendingAnnotationImpact | null; confirmedAnnotationDeletionIds: string[] }) => void;
};

export function createAnnotationGuardPlugin(options: AnnotationGuardPluginOptions) {
  const session = createAnnotationGuardSession(options);
  let editorView: EditorView | null = null;
  let pendingCut: {
    token: number;
    beforeDoc: EditorView["state"]["doc"];
    selectionSignature: string;
    html: string;
    text: string;
  } | null = null;

  function writeDeferredClipboard(payload: { html: string; text: string }) {
    let copied = false;
    const handleCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.clearData();
      event.clipboardData.setData("text/html", payload.html);
      event.clipboardData.setData("text/plain", payload.text);
      copied = true;
    };
    document.addEventListener("copy", handleCopy, { capture: true });
    try {
      document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      document.removeEventListener("copy", handleCopy, { capture: true });
    }
    return copied;
  }

  const milkdownPlugin = $prose(() => new Plugin({
    filterTransaction(transaction, state) {
      const decision = session.inspectTransaction(state, transaction, {
        source: transaction.getMeta("composition") !== undefined ? "composition" : undefined,
      });
      if (decision.kind === "ALLOW" || decision.kind === "ALLOW_CONFIRMED") return true;
      if (decision.kind === "REPLACE") {
        queueMicrotask(() => {
          if (!editorView || !editorView.state.doc.eq(state.doc)
            || JSON.stringify(editorView.state.selection.toJSON()) !== JSON.stringify(state.selection.toJSON())) return;
          editorView.dispatch(decision.transaction);
        });
      }
      return false;
    },
    state: {
      init: () => null,
      apply(transaction, value, oldState, newState) {
        session.acceptTransaction(oldState, transaction, newState);
        return value;
      },
    },
    props: {
      transformCopied(slice) {
        const markType = editorView?.state.schema.marks.annotation;
        return markType ? stripAnnotationMarksFromSlice(slice, markType) : slice;
      },
      transformPasted(slice, view) {
        const markType = view.state.schema.marks.annotation;
        if (!markType) return slice;
        return inheritDestinationAnnotationMark(stripAnnotationMarksFromSlice(slice, markType), view.state, markType);
      },
      handleDOMEvents: {
        cut(view, event) {
          if (view.state.selection.empty) return false;
          const transaction = view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut");
          const decision = session.inspectTransaction(view.state, transaction);
          if (decision.kind === "ALLOW" || decision.kind === "ALLOW_CONFIRMED") return false;
          event.preventDefault();
          if (decision.kind !== "BLOCK") return true;
          const markType = view.state.schema.marks.annotation;
          const slice = markType
            ? stripAnnotationMarksFromSlice(view.state.selection.content(), markType)
            : view.state.selection.content();
          const serialized = view.serializeForClipboard(slice);
          pendingCut = {
            token: decision.pending.token,
            beforeDoc: view.state.doc,
            selectionSignature: JSON.stringify(view.state.selection.toJSON()),
            html: serialized.dom.innerHTML,
            text: serialized.text,
          };
          return true;
        },
        compositionstart(view, event) {
          const decision = session.beginComposition(view.state);
          if (decision.kind !== "BLOCK") return false;
          event.preventDefault();
          return true;
        },
        beforeinput(_view, event) {
          const input = event as InputEvent;
          if (!session.blockCompositionUpdate() || (!input.isComposing && !input.inputType.includes("Composition"))) return false;
          event.preventDefault();
          return true;
        },
        compositionend(view, event) {
          const cancelled = (event as CompositionEvent).data.length === 0;
          const restoreAnnotationIds = session.endComposition(cancelled);
          if (restoreAnnotationIds.length > 0) {
            window.setTimeout(() => {
              const present = new Set(analyzeAnnotationRanges(view.state.doc).ranges.map((range) => range.annotationId));
              if (restoreAnnotationIds.every((id) => present.has(id))) return;
              undo(view.state, (transaction) => view.dispatch(transaction));
            }, 0);
          }
          return false;
        },
      },
    },
    view(view) {
      editorView = view;
      return {
        destroy() {
          if (editorView === view) editorView = null;
        },
      };
    },
  }));

  function confirmPending(token: number): AnnotationConfirmationResult | null {
    if (!editorView) return null;
    if (pendingCut?.token === token) {
      const cut = pendingCut;
      pendingCut = null;
      const stateMatches = cut.beforeDoc.eq(editorView.state.doc)
        && cut.selectionSignature === JSON.stringify(editorView.state.selection.toJSON());
      if (!stateMatches) return session.confirmPendingAnnotationImpact(token, editorView.state);
      if (!writeDeferredClipboard(cut)) {
        pendingCut = cut;
        return { kind: "CLIPBOARD_ERROR", message: "浏览器未允许写入剪贴板，正文没有改变，请重试" };
      }
    }
    const result = session.confirmPendingAnnotationImpact(token, editorView.state);
    if (result.kind === "APPLY") editorView.dispatch(result.transaction);
    editorView.focus();
    return result;
  }

  return {
    milkdownPlugin,
    pendingImpact: session.pendingImpact,
    confirmPending,
    cancelPending(token: number) {
      if (pendingCut?.token === token) pendingCut = null;
      session.cancelPendingAnnotationImpact(token);
      editorView?.focus();
    },
    discard() {
      pendingCut = null;
      session.discard();
    },
  };
}
