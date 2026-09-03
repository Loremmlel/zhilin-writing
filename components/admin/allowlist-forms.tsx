"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import type { AllowlistActionState } from "@/app/(site)/admin/actions";

type AllowlistAction = (
  state: AllowlistActionState,
  formData: FormData,
) => Promise<AllowlistActionState>;

export function AddAllowlistForm({ action }: { action: AllowlistAction }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.success]);
  return (
    <form ref={formRef} action={formAction} className="inline-form" noValidate aria-busy={pending}>
      <input
        className="text-input"
        type="email"
        name="email"
        placeholder="friend@example.com"
        aria-invalid={Boolean(state.error)}
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
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RemoveAllowlistForm({ action, id }: { action: AllowlistAction; id: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);
  return (
    <form action={formAction} noValidate aria-busy={pending}>
      <input type="hidden" name="id" value={id} />
      <button
        className="text-button text-button--danger"
        disabled={pending || state.code === "ACCESS_REVOKED"}
        aria-busy={pending}
      >
        {pending ? "移除中…" : "移除"}
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
