"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type ModalDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  alert?: boolean;
  surfaceClassName?: string;
  backdropClassName?: string;
};

const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function ModalDialog({ open, title, description, onClose, children, alert = false, surfaceClassName, backdropClassName }: ModalDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = rootRef.current;
    const focusable = () => root ? [...root.querySelectorAll<HTMLElement>(focusableSelector)] : [];
    window.setTimeout(() => (focusable()[0] ?? root)?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        root?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={`dialog-backdrop${backdropClassName ? ` ${backdropClassName}` : ""}`} onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={rootRef}
        className={`dialog-surface${surfaceClassName ? ` ${surfaceClassName}` : ""}`}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </header>
        {children}
      </div>
    </div>
  );
}
