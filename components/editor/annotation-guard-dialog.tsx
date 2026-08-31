"use client";

import { ModalDialog } from "@/components/modal-dialog";
import type { PendingAnnotationImpact } from "@/lib/editor/annotation-session";

export type AnnotationGuardMetadata = {
  annotationId: string;
  authorName: string;
  replyCount: number;
};

type AnnotationGuardDialogProps = {
  pending: PendingAnnotationImpact | null;
  annotations: AnnotationGuardMetadata[];
  message?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AnnotationGuardDialog({ pending, annotations, message, onCancel, onConfirm }: AnnotationGuardDialogProps) {
  const metadata = new Map(annotations.map((annotation) => [annotation.annotationId, annotation]));
  const count = pending?.affectedAnnotationIds.length ?? 0;
  return (
    <ModalDialog
      open={Boolean(pending)}
      title={count > 1 ? `此修改会撤下 ${count} 条批注` : "此修改会撤下这条批注"}
      description="被批注文字的语义边界将被破坏，相关讨论会在保存修改后退出当前版本。"
      onClose={onCancel}
      alert
    >
      {pending && <>
        <ul className="annotation-guard-list" aria-label="受影响的批注">
          {pending.affectedAnnotationIds.slice(0, 5).map((annotationId) => {
            const annotation = metadata.get(annotationId);
            const excerpt = pending.excerpts.find((item) => item.annotationId === annotationId)?.text ?? "被批注文字";
            return <li key={annotationId}>
              <blockquote>{excerpt}</blockquote>
              <span>{annotation?.authorName ?? "批注作者"} · {annotation?.replyCount ?? 0} 条回复</span>
            </li>;
          })}
        </ul>
        {count > 5 && <p className="muted">另有 {count - 5} 条批注同时受影响。</p>}
        <p className="annotation-guard-local-note">现在只会修改本地草稿；批注讨论将在你保存正文时一并撤下。撤销或放弃草稿可完整恢复。</p>
        {message && <p className="form-error" role="alert">{message}</p>}
        <div className="dialog-actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>取消</button>
          <button type="button" className="button button--danger" onClick={onConfirm}>继续修改并撤下批注</button>
        </div>
      </>}
    </ModalDialog>
  );
}
