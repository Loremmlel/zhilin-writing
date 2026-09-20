"use client";

import { useActionState } from "react";
import { runRecoverableAction } from "./recoverable-action.ts";

// For in-place, idempotent submissions: failures stay in the form, with no navigation or replay.
export function useRecoverableActionState<State extends { error?: string; incidentId?: string }>(
  action: (previous: State, formData: FormData) => Promise<State>,
  initialState: Awaited<State>,
) {
  return useActionState<State, FormData>(
    (previous: State, formData: FormData) =>
      runRecoverableAction(action, previous, formData, initialState),
    initialState,
  );
}
