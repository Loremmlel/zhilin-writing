import { PERFORMANCE_ENDPOINT, performanceRoute } from "./performance/shared.ts";

type ErrorSource = "runtime" | "unhandledrejection" | "react" | "action" | "resource";
type ErrorRecord = Record<string, string | number>;
let emit: ((record: ErrorRecord) => void) | undefined;
const seen = new WeakMap<object, string>();
const recent = new Map<string, { id: string; time: number }>();
let windowStart = 0;
let reported = 0;

// Keep bundle locations, never error messages, function names or arbitrary URLs.
export function clientErrorDetails(error: unknown, origin: string) {
  const value = error instanceof Error ? error : null;
  const errorName =
    value &&
    /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError|AbortError|TimeoutError)$/.test(
      value.name,
    )
      ? value.name
      : "Unknown";
  const message = value?.message ?? "";
  const errorCode =
    /Failed to fetch dynamically imported module|Loading chunk .* failed|ChunkLoadError/.test(
      message,
    )
      ? "CHUNK_LOAD_FAILED"
      : message === "Resource load failed"
        ? "RESOURCE_LOAD_FAILED"
        : /Failed to fetch|NetworkError|Load failed/.test(message)
          ? "FETCH_FAILED"
          : errorName === "AbortError"
            ? "ABORTED"
            : "UNEXPECTED_ERROR";
  const frames: string[] = [];
  for (const match of (value?.stack ?? "")
    .slice(0, 12000)
    .matchAll(/https?:\/\/[^\s)]+:(\d+):(\d+)/g)) {
    const parts = /^(.*):(\d+):(\d+)$/.exec(match[0]);
    if (!parts) continue;
    try {
      const url = new URL(parts[1]);
      const bundle =
        /^\/(?:assets|_vinext|_next\/static\/chunks)\/([A-Za-z0-9_-]{1,120}\.m?js)$/.exec(
          url.pathname,
        );
      if (url.origin === origin && bundle && !url.search && !url.hash)
        frames.push(`${bundle[1]}:${parts[2]}:${parts[3]}`);
    } catch {
      /* Ignore non-bundle locations. */
    }
    if (frames.length === 5) break;
  }
  const digest = (value as (Error & { digest?: unknown }) | null)?.digest;
  return {
    errorName,
    errorCode,
    frames: frames.join("|"),
    ...(typeof digest === "string" && /^\d{1,10}$/.test(digest) ? { renderDigest: digest } : {}),
  };
}

export function reportClientError(error: unknown, source: ErrorSource): string | undefined {
  if (typeof window === "undefined") return;
  let incidentId: string | undefined;
  try {
    const object =
      error !== null && (typeof error === "object" || typeof error === "function") ? error : null;
    if (object && seen.has(object)) return seen.get(object);
    incidentId = crypto.randomUUID();
    const now = Date.now();
    const details = clientErrorDetails(error, window.location.origin);
    const route = performanceRoute(window.location.pathname);
    const fingerprint = JSON.stringify([source, route, details]);
    const previous = recent.get(fingerprint);
    if (previous && now - previous.time < 5000) {
      if (object) seen.set(object, previous.id);
      return previous.id;
    }
    if (now - windowStart >= 60_000) {
      windowStart = now;
      reported = 0;
    }
    if (object) seen.set(object, incidentId);
    if (reported >= 20) return incidentId;
    reported++;
    if (recent.size >= 50) recent.delete(recent.keys().next().value!);
    recent.set(fingerprint, { id: incidentId, time: now });
    const record = {
      kind: "client_error",
      incidentId,
      errorSource: source,
      route,
      observedAt: now,
      ...details,
    };
    if (emit) emit(record);
    else {
      // The root error page can mount before instrumentation has installed its queue.
      void window
        .fetch(PERFORMANCE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([record]),
          keepalive: true,
          credentials: "same-origin",
        })
        .catch(() => {});
    }
  } catch {
    /* Diagnostics must never replace the original error or break recovery. */
  }
  return incidentId;
}

export function installClientErrorReporting(send: (record: ErrorRecord) => void) {
  if (typeof window === "undefined" || emit) return;
  emit = send;
  window.addEventListener(
    "error",
    (event: Event) => {
      if (event instanceof ErrorEvent)
        reportClientError(event.error ?? new Error(event.message), "runtime");
      else if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement)
        reportClientError(new Error("Resource load failed"), "resource");
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) =>
    reportClientError(event.reason, "unhandledrejection"),
  );
}
