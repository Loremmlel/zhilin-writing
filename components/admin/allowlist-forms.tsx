"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AllowlistActionState } from "@/app/(site)/admin/actions";
import { ModalDialog } from "@/components/modal-dialog";

type AllowlistAction = (
  state: AllowlistActionState,
  formData: FormData,
) => Promise<AllowlistActionState>;

export function AddAllowlistForm({ action }: { action: AllowlistAction }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.success]);
  return (
    <form
      ref={formRef}
      action={formAction}
      className="allowlist-add-form"
      noValidate
      aria-busy={pending}
    >
      <label htmlFor={inputId}>邮箱地址</label>
      <input
        id={inputId}
        className="text-input"
        type="email"
        name="email"
        placeholder="name@example.com"
        aria-invalid={Boolean(state.error)}
        aria-describedby={state.error ? `${inputId}-error` : undefined}
        disabled={pending || state.code === "ACCESS_REVOKED"}
      />
      <button
        className="button button--primary"
        disabled={pending || state.code === "ACCESS_REVOKED"}
        aria-busy={pending}
      >
        {pending ? "正在添加…" : "加入白名单"}
      </button>
      {state.error && (
        <p className="form-error" id={`${inputId}-error`} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RemoveAllowlistForm({
  action,
  id,
  email,
}: {
  action: AllowlistAction;
  id: string;
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previous: AllowlistActionState, formData: FormData) => {
      const result = await action(previous, formData);
      if (result.success) setOpen(false);
      return result;
    },
    {},
  );
  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);
  return (
    <>
      <button
        className="text-button text-button--danger"
        type="button"
        onClick={() => setOpen(true)}
      >
        移除
      </button>
      <ModalDialog
        open={open}
        title={`移除 ${email}？`}
        description="该邮箱将无法再次进入社区；已经发布的帖子、回复和批注会继续保留。"
        onClose={() => !pending && setOpen(false)}
        alert
      >
        <form action={formAction} className="moderation-form" noValidate aria-busy={pending}>
          <input type="hidden" name="id" value={id} />
          {state.error && (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button button--ghost"
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              className="button button--danger"
              type="submit"
              disabled={pending || state.code === "ACCESS_REVOKED"}
              aria-busy={pending}
            >
              {pending ? "正在移除…" : "移出白名单"}
            </button>
          </div>
        </form>
      </ModalDialog>
    </>
  );
}
