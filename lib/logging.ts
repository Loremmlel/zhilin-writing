type ServerErrorContext = {
  operation: string;
  error?: unknown;
  errorCode?: string;
  entityId?: string | null;
  userId?: string | null;
};

function safeToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : "REDACTED";
}

export function serverErrorCode(error: unknown, fallback = "INTERNAL_ERROR"): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  }
  return fallback;
}

export function logServerError(context: ServerErrorContext): void {
  const record = {
    level: "error",
    event: "server_operation_failed",
    operation: safeToken(context.operation) ?? "REDACTED",
    entityId: safeToken(context.entityId),
    userId: safeToken(context.userId),
    errorCode: safeToken(context.errorCode) ?? serverErrorCode(context.error),
    requestId: crypto.randomUUID(),
  };
  console.error(JSON.stringify(record));
}
