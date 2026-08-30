"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import { ModalDialog } from "@/components/modal-dialog";

export type LifecycleActionState = { success?: boolean; error?: string };
export type LifecycleFormAction = (
  state: LifecycleActionState,
  formData: FormData,
) => Promise<LifecycleActionState>;

export function DeleteContentControl({
  action,
  label,
  title,
  description,
  confirmLabel = "确认删除",
  pendingLabel = "正在删除…",
}: {
  action: LifecycleFormAction;
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  pendingLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: LifecycleActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.success) {
      setOpen(false);
      router.refresh();
    }
    return result;
  }, {});

  return <>
    <button className="text-button text-button--danger" type="button" onClick={() => setOpen(true)}>{label}</button>
    <ModalDialog open={open} title={title} description={description} onClose={() => !pending && setOpen(false)} alert>
      <form action={formAction} className="dialog-actions" noValidate>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        <button className="button button--ghost" type="button" disabled={pending} onClick={() => setOpen(false)}>取消</button>
        <button className="button button--danger" type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingLabel : confirmLabel}</button>
      </form>
    </ModalDialog>
  </>;
}
