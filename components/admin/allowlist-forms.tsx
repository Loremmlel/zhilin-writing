"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AllowlistActionState } from "@/app/(site)/admin/actions";
import { ActionErrorMessage } from "@/components/action-error-message";
import { ModalDialog } from "@/components/modal-dialog";
import { PendingSubmitButton } from "@/components/pending/pending-submit-button";
import { permissionGroupLabels, type PermissionGroup } from "@/lib/auth/permissions";
import { PasswordField } from "@/components/auth/password-field";
import { passwordError } from "@/lib/auth/password-policy";
import { useRecoverableActionState } from "@/lib/actions/use-recoverable-action-state";

type AllowlistAction = (
  state: AllowlistActionState,
  formData: FormData,
) => Promise<AllowlistActionState>;

export function SetMemberPasswordForm({
  action,
  id,
  email,
  hasPassword,
}: {
  action: AllowlistAction;
  id: string;
  email: string;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  return (
    <>
      <button
        className="text-button"
        type="button"
        onClick={() => {
          setFeedback("");
          setOpen(true);
        }}
      >
        {hasPassword ? "重置密码" : "设置密码"}
      </button>
      <span className="sr-only" role="status">
        {feedback}
      </span>
      <ModalDialog
        open={open}
        title={`为 ${email} ${hasPassword ? "重置" : "设置"}密码`}
        description="密码须为 12–128 个字符。保存后，该成员已有的邮箱密码登录将失效；ChatGPT 登录仍可使用。"
        onClose={() => !pending && setOpen(false)}
      >
        <MemberPasswordEditor
          action={action}
          id={id}
          onPending={setPending}
          onCancel={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            setFeedback("密码已设置");
            router.refresh();
          }}
        />
      </ModalDialog>
    </>
  );
}

function MemberPasswordEditor({
  action,
  id,
  onPending,
  onCancel,
  onSuccess,
}: {
  action: AllowlistAction;
  id: string;
  onPending: (pending: boolean) => void;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const [state, formAction, pending] = useRecoverableActionState<AllowlistActionState>(
    async (previous, data) => {
      const password = String(data.get("password") ?? "");
      const error =
        passwordError(password) ??
        (password !== data.get("confirmPassword") ? "两次输入的密码不一致" : null);
      if (error) return { error };
      const result = await action(previous, data);
      if (result.success) onSuccess();
      return result;
    },
    {},
  );
  useEffect(() => {
    onPending(pending);
  }, [onPending, pending]);
  useEffect(() => {
    if (pending || !state.error) return;
    (
      formRef.current?.elements.namedItem(
        state.error.includes("一致") ? "confirmPassword" : "password",
      ) as HTMLInputElement
    )?.focus();
  }, [pending, state.error]);
  return (
    <form
      ref={formRef}
      action={formAction}
      className="moderation-form"
      noValidate
      aria-busy={pending}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <PasswordField
        autoComplete="new-password"
        label="新密码"
        disabled={pending}
        invalid={Boolean(state.error)}
        errorId={state.error ? errorId : undefined}
      />
      <PasswordField
        name="confirmPassword"
        autoComplete="new-password"
        label="确认密码"
        disabled={pending}
        invalid={Boolean(state.error)}
        errorId={state.error ? errorId : undefined}
      />
      <ActionErrorMessage error={state.error} incidentId={state.incidentId} id={errorId} />
      <div className="dialog-actions">
        <button
          className="button button--ghost"
          type="button"
          disabled={pending}
          onClick={onCancel}
        >
          取消
        </button>
        <PendingSubmitButton
          className="button button--primary"
          disabled={pending || state.code === "ACCESS_REVOKED"}
          pendingLabel="正在保存…"
        >
          保存密码
        </PendingSubmitButton>
      </div>
    </form>
  );
}

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
