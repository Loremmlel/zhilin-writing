"use client";

import { AnnotationThread, type AnnotationCardView, type AnnotationDeleteAction, type AnnotationRemoveImportedAction, type AnnotationReplyAction, type AnnotationReplyDeleteAction } from "./annotation-thread";
import { ModalDialog } from "@/components/modal-dialog";

export function AnnotationSheet({ annotation, open, onClose, replyAction, deleteAction, deleteReplyAction, removeImportedAction }: {
  annotation: AnnotationCardView | null; open: boolean; onClose: () => void;
  replyAction: AnnotationReplyAction; deleteAction: AnnotationDeleteAction; deleteReplyAction: AnnotationReplyDeleteAction; removeImportedAction: AnnotationRemoveImportedAction;
}) {
  if (!annotation) return null;
  const characters = Array.from(annotation.originalSelectedText);
  const excerpt = characters.length > 120 ? `${characters.slice(0, 120).join("")}…` : annotation.originalSelectedText;
  return <ModalDialog open={open} title="正文批注" description={`选中文字：${excerpt}`} onClose={onClose} surfaceClassName="annotation-sheet-surface" backdropClassName="annotation-sheet-backdrop">
    <div className="annotation-sheet-actions"><button type="button" className="button button--ghost button--small" onClick={onClose}>关闭</button></div>
    <div className="annotation-sheet-thread"><AnnotationThread annotation={annotation} replyAction={replyAction} deleteAction={deleteAction} deleteReplyAction={deleteReplyAction} removeImportedAction={removeImportedAction} /></div>
  </ModalDialog>;
}
