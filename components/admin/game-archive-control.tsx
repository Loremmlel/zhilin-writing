"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModalDialog } from "@/components/modal-dialog";
import { ActionErrorMessage } from "@/components/action-error-message";
import { PendingSubmitButton } from "@/components/pending/pending-submit-button";
import { useRecoverableActionState } from "@/lib/actions/use-recoverable-action-state";
import type { GameArchiveActionState } from "@/app/(site)/admin/games/actions";

type Action = (state: GameArchiveActionState, data: FormData) => Promise<GameArchiveActionState>;
export function GameArchiveControl({ action, active }: { action: Action; active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useRecoverableActionState(
    async (previous: GameArchiveActionState, data: FormData) => {
      const result = await action(previous, data);
      if (result.success) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    {},
  );
  const label = active ? "异常结束" : "归档";
  return (
    <>
      <button
        type="button"
        className={active ? "text-button text-button--danger" : "text-button"}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <ModalDialog
        open={open}
        title={active ? "结束这局对局？" : "归档这局对局？"}
        description={
          active
            ? "双方将无法继续操作，不判定胜负。已有过程会保留并归档，此操作不可撤销。"
            : "将现有记录保存为可下载的 JSON 文件。历史不完整的旧局无法补回缺失步骤。"
        }
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        alert
      >
        <form action={formAction} className="moderation-form" noValidate aria-busy={pending}>
          <ActionErrorMessage error={state.error} incidentId={state.incidentId} />
          <div className="dialog-actions">
            <button
              className="button button--ghost"
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <PendingSubmitButton
              className={active ? "button button--danger" : "button button--primary"}
              pendingLabel="正在处理…"
            >
              {active ? "确认结束" : "开始归档"}
            </PendingSubmitButton>
          </div>
        </form>
      </ModalDialog>
    </>
  );
}
