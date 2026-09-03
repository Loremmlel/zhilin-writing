"use client";

import { useActionState } from "react";

import type { NotificationActionState } from "@/app/(site)/notifications/actions";
import { PendingSubmitButton } from "@/components/pending/pending-submit-button";

export function MarkAllNotificationsForm({ action }: {
  action: (state: NotificationActionState, formData: FormData) => Promise<NotificationActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return <form action={formAction} noValidate aria-busy={pending}>
    <PendingSubmitButton className="button button--ghost button--small" pendingLabel="标记中…" disabled={state.code === "ACCESS_REVOKED"}>全部标记已读</PendingSubmitButton>
    {state.error && <p className="form-error notification-action-error" role="alert">{state.error}</p>}
  </form>;
}
