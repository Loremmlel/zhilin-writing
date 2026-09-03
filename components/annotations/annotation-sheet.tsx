"use client";

import { AnnotationReadonlyThread } from "./annotation-readonly-thread";
import { AnnotationThread, type AnnotationCardView, type AnnotationDeleteAction, type AnnotationRemoveImportedAction, type AnnotationReplyAction, type AnnotationReplyDeleteAction } from "./annotation-thread";
import { ModalDialog } from "@/components/modal-dialog";

type AnnotationSheetProps = {
  annotation: AnnotationCardView | null; open: boolean; onClose: () => void;
  onLocate?: () => void;
  highlightReplyId?: string | null;
  highlighted?: boolean;
} & ({
  readOnly: true;
  replyAction?: never;
  deleteAction?: never;
  deleteReplyAction?: never;
  removeImportedAction?: never;
} | {
  readOnly?: false;
  replyAction: AnnotationReplyAction;
  deleteAction: AnnotationDeleteAction;
  deleteReplyAction: AnnotationReplyDeleteAction;
  removeImportedAction: AnnotationRemoveImportedAction;
});

export function AnnotationSheet(props: AnnotationSheetProps) {
  const { annotation, open, onClose, onLocate, highlightReplyId, highlighted = false } = props;
  if (!annotation) return null;
  const characters = Array.from(annotation.originalSelectedText);
  const excerpt = characters.length > 120 ? `${characters.slice(0, 120).join("")}…` : annotation.originalSelectedText;
  return <ModalDialog open={open} title="正文批注" description={`选中文字：${excerpt}`} onClose={onClose} surfaceClassName="annotation-sheet-surface" backdropClassName="annotation-sheet-backdrop">
    <div className="annotation-sheet-actions"><button type="button" className="button button--ghost button--small" onClick={onClose}>关闭</button></div>
    <div className={`annotation-sheet-thread${highlighted ? " is-deep-linked" : ""}`}>{props.readOnly === true
      ? <AnnotationReadonlyThread annotation={annotation} onLocate={onLocate} />
      : <AnnotationThread annotation={annotation} replyAction={props.replyAction} deleteAction={props.deleteAction} deleteReplyAction={props.deleteReplyAction} removeImportedAction={props.removeImportedAction} onLocate={onLocate} highlightReplyId={highlightReplyId} />}
    </div>
  </ModalDialog>;
}
