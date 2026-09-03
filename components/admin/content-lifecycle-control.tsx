"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import type { LifecycleActionState, LifecycleFormAction } from "@/components/lifecycle/delete-content-control";
import { ModalDialog } from "@/components/modal-dialog";

export function ContentLifecycleControl({
  action,
  operation,
  targetLabel,
}: {
  action: LifecycleFormAction;
  operation: "hide" | "unhide" | "restore";
  targetLabel: "帖子" | "回复" | "批注" | "批注回复";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());
  const [state, formAction, pending] = useActionState(async (previous: LifecycleActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.success) {
      setOpen(false);
      setReason("");
      router.refresh();
    }
    return result;
  }, {});
  const copy = operation === "hide"
    ? { label: "隐藏", title: `隐藏这条${targetLabel}？`, description: "普通成员将看不到原文；其他成员已经发布的讨论不会被删除。" }
    : operation === "unhide"
      ? { label: "取消隐藏", title: `取消隐藏这条${targetLabel}？`, description: "若内容同时处于作者已删除状态，取消隐藏后仍不会公开。" }
      : { label: "恢复作者删除", title: `恢复这条${targetLabel}？`, description: "恢复当前内容，不会新增正文版本，也不会生成公开动态。" };

  return <>
    <button className={operation === "hide" ? "text-button text-button--danger" : "text-button"} type="button" onClick={() => setOpen(true)}>{copy.label}</button>
    <ModalDialog open={open} title={copy.title} description={copy.description} onClose={() => !pending && setOpen(false)} alert>
      <form action={formAction} className="moderation-form" noValidate>
        <input type="hidden" name="operationId" value={operationId} />
        {operation === "hide" && <label className="field-label">原因（可选）<textarea className="text-area" name="reason" rows={3} maxLength={300} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} /></label>}
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        <div className="dialog-actions">
          <button className="button button--ghost" type="button" disabled={pending} onClick={() => setOpen(false)}>取消</button>
          <button className={operation === "hide" ? "button button--danger" : "button button--primary"} type="submit" disabled={pending || state.code === "ACCESS_REVOKED"} aria-busy={pending}>{pending ? "正在更新…" : copy.label}</button>
        </div>
      </form>
    </ModalDialog>
  </>;
}
