"use client";

import { useActionState, useState } from "react";

import { ModalDialog } from "@/components/modal-dialog";
import { PendingSubmitButton } from "@/components/pending/pending-submit-button";
import type { ActionAccessErrorCode } from "@/lib/actions/result";

type RestoreRevisionActionState = { error?: string; code?: ActionAccessErrorCode };

export function RestoreRevisionForm({
  revisionNumber,
  action,
  restoresDeletedPost = false,
  annotationCount = 0,
  exitingAnnotationCount = 0,
}: {
  revisionNumber: number;
  action: (
    state: RestoreRevisionActionState,
    formData: FormData,
  ) => Promise<RestoreRevisionActionState>;
  restoresDeletedPost?: boolean;
  annotationCount?: number;
  exitingAnnotationCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <>
      <button type="button" className="button button--ghost" onClick={() => setOpen(true)}>
        恢复此版本
      </button>
      <ModalDialog
        open={open}
        title={`恢复 v${revisionNumber}？`}
        description={`${
          restoresDeletedPost
            ? "恢复会把这份历史内容复制成新的当前版本，并清除作者删除状态；若仍被管理员隐藏，普通成员仍不可见。"
            : "恢复会把这份历史内容复制成一个新的当前版本；现有版本不会被删除。"
        } 此版本包含 ${annotationCount} 条批注。${exitingAnnotationCount > 0 ? `恢复后，当前正文中的 ${exitingAnnotationCount} 条批注将不再属于当前版本。` : ""} 帖子不会被顶到最近活跃。`}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        alert
      >
        <form
          action={formAction}
          className={`dialog-actions${state.error ? " dialog-actions--with-error" : ""}`}
          noValidate
          aria-busy={pending}
        >
          <input type="hidden" name="operationId" value={operationId} />
          {state.error && (
            <p className="form-error dialog-form-error" role="alert">
              {state.error}
            </p>
          )}
          <button
            type="button"
            className="button button--ghost"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            取消
          </button>
          <PendingSubmitButton
            className="button button--danger"
            pendingLabel="正在恢复…"
            disabled={state.code === "ACCESS_REVOKED"}
          >
            确认恢复
          </PendingSubmitButton>
        </form>
      </ModalDialog>
    </>
  );
}
