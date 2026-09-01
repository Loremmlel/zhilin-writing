"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children" | "type"> & {
  children: ReactNode;
  pendingLabel: string;
};

export function PendingSubmitButton({ children, className = "", disabled, pendingLabel, ...props }: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return <>
    <button
      {...props}
      type="submit"
      className={`${className}${pending ? " button--pending" : ""}`}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      <span className="pending-submit-labels">
        <span aria-hidden={pending}>{children}</span>
        <span aria-hidden={!pending}>{pendingLabel}</span>
      </span>
    </button>
    <span className="sr-only" role="status" aria-live="polite">{pending ? pendingLabel : ""}</span>
  </>;
}
