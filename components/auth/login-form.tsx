"use client";

import { useId, useRef, useState } from "react";
import { ActionErrorMessage } from "@/components/action-error-message";
import { PasswordField } from "./password-field";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const id = useId();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error?: string; incidentId?: string; field?: string }>(
    {},
  );
  return (
    <form
      className="login-form"
      noValidate
      aria-busy={pending}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy.current) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const email = String(data.get("email") ?? "").trim();
        const password = String(data.get("password") ?? "");
        const field = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          ? "email"
          : !password
            ? "password"
            : undefined;
        if (field) {
          setFailure({ error: field === "email" ? "请输入有效邮箱。" : "请输入密码。", field });
          (form.elements.namedItem(field) as HTMLInputElement)?.focus();
          return;
        }
        busy.current = true;
        setPending(true);
        setFailure({});
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, returnTo }),
            signal: AbortSignal.timeout(20_000),
          });
          const result = (await response.json()) as {
            returnTo?: string;
            error?: string;
            incidentId?: string;
          };
          if (response.ok && typeof result.returnTo === "string") {
            window.location.assign(result.returnTo);
            return;
          }
          setFailure({
            error: result.error ?? "暂时无法登录，请稍后重试。",
            incidentId: result.incidentId,
          });
        } catch {
          setFailure({ error: "未收到登录结果，请检查网络后重试。" });
        }
        busy.current = false;
        setPending(false);
      }}
    >
      <div>
        <label className="field-label" htmlFor={`${id}-email`}>
          邮箱
        </label>
        <input
          id={`${id}-email`}
          className="text-input"
          type="email"
          name="email"
          autoComplete="username"
          maxLength={254}
          disabled={pending}
          required
          aria-invalid={failure.field === "email"}
          aria-describedby={failure.error ? `${id}-error` : undefined}
        />
      </div>
      <PasswordField
        disabled={pending}
        invalid={failure.field === "password"}
        errorId={failure.error ? `${id}-error` : undefined}
      />
      <ActionErrorMessage {...failure} id={`${id}-error`} />
      <button
        className="button button--primary login-submit"
        type="submit"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "正在登录…" : "登录"}
      </button>
      <span className="sr-only" role="status">
        {pending ? "正在登录" : ""}
      </span>
    </form>
  );
}
