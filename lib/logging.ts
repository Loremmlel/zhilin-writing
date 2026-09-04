type ServerErrorContext = {
  operation: string;
  error?: unknown;
  errorCode?: string;
  entityId?: string | null;
  stage?: string | null;
  userId?: string | null;
};

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_CAUSE_DEPTH = 2;

function safeToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : "REDACTED";
}

export function serverErrorCode(error: unknown, fallback = "INTERNAL_ERROR"): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (ERROR_CODE_PATTERN.test(code)) return code;
  }
  return fallback;
}

function errorCause(error: unknown): unknown {
  return error && typeof error === "object" && "cause" in error ? error.cause : undefined;
}

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("name" in error)) return undefined;
  return safeToken(String(error.name));
}

function errorStage(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("stage" in error)) return undefined;
  return safeToken(String(error.stage));
}

function errorReason(error: unknown): string {
  let current = error;
  for (let depth = 0; current && depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (current instanceof Error) {
      const message = current.message;
      if (/foreign key/i.test(message)) return "FOREIGN_KEY_CONSTRAINT";
      if (/not null/i.test(message)) return "NOT_NULL_CONSTRAINT";
      if (/unique constraint|constraint unique/i.test(message)) return "UNIQUE_CONSTRAINT";
      if (/check constraint/i.test(message)) return "CHECK_CONSTRAINT";
      if (/database is locked|sqlite_busy/i.test(message)) return "DATABASE_BUSY";
      if (current instanceof TypeError) return "TYPE_ERROR";
      if (current instanceof ReferenceError) return "REFERENCE_ERROR";
      if (current instanceof RangeError) return "RANGE_ERROR";
    }
    current = errorCause(current);
  }
  return "UNCLASSIFIED";
}

export function markServerErrorStage(error: unknown, stage: string): unknown {
  if (!error || typeof error !== "object" || "stage" in error) return error;
  try {
    Object.defineProperty(error, "stage", { value: stage, configurable: true });
  } catch {
    // Non-extensible third-party errors are still safe to log without a stage.
  }
  return error;
}

export function logServerError(context: ServerErrorContext): string {
  const incidentId = crypto.randomUUID();
  const cause = errorCause(context.error);
  const record = {
    level: "error",
    event: "server_operation_failed",
    operation: safeToken(context.operation) ?? "REDACTED",
    stage: errorStage(context.error) ?? safeToken(context.stage),
    entityId: safeToken(context.entityId),
    userId: safeToken(context.userId),
    operationCode: ERROR_CODE_PATTERN.test(context.errorCode ?? "")
      ? context.errorCode
      : "INTERNAL_ERROR",
    errorCode: serverErrorCode(context.error),
    errorName: errorName(context.error),
    reason: errorReason(context.error),
    causeErrorCode: cause ? serverErrorCode(cause) : undefined,
    causeErrorName: errorName(cause),
    incidentId,
  };
  console.error(JSON.stringify(record));
  return incidentId;
}
