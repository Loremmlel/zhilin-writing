"use client";

import { useId, useState } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

export function PasswordField({
  name = "password",
  label = "密码",
  autoComplete = "current-password",
  disabled = false,
  errorId,
  invalid = false,
}: {
  name?: string;
  label?: string;
  autoComplete?: "current-password" | "new-password";
  disabled?: boolean;
  errorId?: string;
  invalid?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  return (
    <div className="password-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="password-input-row">
        <input
          id={id}
          className="text-input"
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={autoComplete === "new-password" ? PASSWORD_MIN_LENGTH : undefined}
          maxLength={PASSWORD_MAX_LENGTH}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={errorId}
          required
        />
        <button
          className="text-button password-visibility"
          type="button"
          disabled={disabled}
          aria-controls={id}
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "隐藏" : "显示"}
        </button>
      </div>
    </div>
  );
}
