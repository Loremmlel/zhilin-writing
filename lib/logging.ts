import { requestPerformance } from "./performance/context.ts";
type ServerErrorContext = {
  operation: string;
  renderDigest?: string;
  error?: unknown;
  errorCode?: string;
  entityId?: string | null;
  stage?: string | null;
  userId?: string | null;
};

type ServerRejectionContext = {
  operation: string;
  code: string;
  entityId?: string | null;
  selection?: {
    blockOrdinal: number;
    endBlockOrdinal: number;
    blockTextFrom: number;
    blockTextTo: number;
    selectedTextLength: number;
  };
  stage?: string | null;
  userId?: string | null;
};

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_CAUSE_DEPTH = 2;

function safeToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : "REDACTED";
}

function safeOffset(value: number): number | undefined {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000 ? value : undefined;
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

function declaredErrorReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("reason" in error)) return undefined;
  const reason = String(error.reason);
  return ERROR_CODE_PATTERN.test(reason) ? reason : undefined;
}

function errorReason(error: unknown): string {
  let current = error;
  for (let depth = 0; current && depth <= MAX_CAUSE_DEPTH; depth += 1) {
    const declared = declaredErrorReason(current);
    if (declared) return declared;
    if (current instanceof Error) {
      const message = current.message;
      if (/too many sql variables/i.test(message)) return "SQL_PARAMETER_LIMIT";
      if (/too many columns/i.test(message)) return "SQL_COLUMN_LIMIT";
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
  const performanceContext = requestPerformance.getStore();
  if (performanceContext) performanceContext.incidentId = incidentId;
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
    renderDigest: /^\d{1,10}$/.test(context.renderDigest ?? "") ? context.renderDigest : undefined,
    requestId: requestPerformance.getStore()?.requestId,
  };
  console.error(JSON.stringify(record));
  return incidentId;
}

// Match vinext's production page-boundary digest without logging message or stack.
export function logServerRenderError(context: Omit<ServerErrorContext, "renderDigest">): string {
  const input =
    context.error instanceof Error
      ? context.error.message + (context.error.stack || "")
      : String(context.error);
  let hash = 5381;
  for (let i = input.length - 1; i >= 0; i--) hash = (hash * 33) ^ input.charCodeAt(i);
  return logServerError({ ...context, renderDigest: (hash >>> 0).toString() });
}

export function logServerRejection(context: ServerRejectionContext): string {
  const incidentId = crypto.randomUUID();
  const selection = context.selection
    ? {
        blockOrdinal: safeOffset(context.selection.blockOrdinal),
        endBlockOrdinal: safeOffset(context.selection.endBlockOrdinal),
        blockTextFrom: safeOffset(context.selection.blockTextFrom),
        blockTextTo: safeOffset(context.selection.blockTextTo),
        selectedTextLength: safeOffset(context.selection.selectedTextLength),
      }
    : undefined;
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "server_operation_rejected",
      operation: safeToken(context.operation) ?? "REDACTED",
      stage: safeToken(context.stage),
      entityId: safeToken(context.entityId),
      userId: safeToken(context.userId),
      code: ERROR_CODE_PATTERN.test(context.code) ? context.code : "INVALID_REJECTION_CODE",
      selection,
      incidentId,
      requestId: requestPerformance.getStore()?.requestId,
    }),
  );
  return incidentId;
}

// Called only after the ingestion route validates this untrusted browser report.
export function logClientError(record: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      level: "error",
      event: "client_error_reported",
      source: "client",
      incidentId: record.incidentId,
      errorSource: record.errorSource,
      errorName: record.errorName,
      errorCode: record.errorCode,
      renderDigest: record.renderDigest,
      frames: record.frames,
      route: record.route,
      observedAt: record.observedAt,
      browserId: record.browserId,
      sessionId: record.sessionId,
    }),
  );
}
