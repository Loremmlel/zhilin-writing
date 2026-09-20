"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AllowlistActionState } from "@/app/(site)/admin/actions";
import { ActionErrorMessage } from "@/components/action-error-message";
import { ModalDialog } from "@/components/modal-dialog";
import { PendingSubmitButton } from "@/components/pending/pending-submit-button";
import { permissionGroupLabels, type PermissionGroup } from "@/lib/auth/permissions";

type AllowlistAction = (
  state: AllowlistActionState,
  formData: FormData,
) => Promise<AllowlistActionState>;

function PermissionGroupField({
  value = "normal",
  disabled,
}: {
  value?: PermissionGroup;
  disabled: boolean;
}) {
  return (
    <fieldset className="permission-group-field" disabled={disabled}>
      <legend>权限组</legend>
      {(["normal", "game"] as const).map((group) => (
        <label key={group}>
          <input
            type="radio"
            name="permissionGroup"
            value={group}
            defaultChecked={value === group}
          />
          {permissionGroupLabels[group]}
        </label>
      ))}
    </fieldset>
  );
}

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
      <PermissionGroupField disabled={pending || state.code === "ACCESS_REVOKED"} />
      <PendingSubmitButton
        className="button button--primary"
        disabled={pending || state.code === "ACCESS_REVOKED"}
        pendingLabel="正在添加…"
      >
        加入白名单
      </PendingSubmitButton>
      <ActionErrorMessage
        error={state.error}
        incidentId={state.incidentId}
        id={`${inputId}-error`}
      />
    </form>
  );
}

export function UpdatePermissionGroupForm({
  action,
  id,
  email,
  permissionGroup,
}: {
  action: AllowlistAction;
  id: string;
  email: string;
  permissionGroup: PermissionGroup;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previous: AllowlistActionState, data: FormData) => {
      const result = await action(previous, data);
      if (result.success) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    {},
  );
  return (
    <>
      <button className="text-button" type="button" onClick={() => setOpen(true)}>
        修改权限组
      </button>
      <ModalDialog
        open={open}
        title={`修改 ${email} 的权限组`}
        description="普通组可使用全部社区功能；游戏组仅可使用浩劫 2 和编辑自己的资料。已有内容会保留。"
        onClose={() => !pending && setOpen(false)}
      >
        <form action={formAction} className="moderation-form" noValidate aria-busy={pending}>
          <input type="hidden" name="id" value={id} />
          <PermissionGroupField value={permissionGroup} disabled={pending} />
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
              className="button button--primary"
              disabled={pending || state.code === "ACCESS_REVOKED"}
              pendingLabel="正在保存…"
            >
              确认修改
            </PendingSubmitButton>
          </div>
        </form>
      </ModalDialog>
    </>
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
