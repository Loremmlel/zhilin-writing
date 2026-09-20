export const PERFORMANCE_ENDPOINT = "/api/performance";
export const MAX_BATCH = 30;

export function isHaojiePoll(path: string) {
  return /^\/api\/haojie\/rooms\/[0-9a-f-]{36}$/.test(path);
}

export function shouldSamplePerformance(
  method: string,
  path: string,
  status: number,
  sample = Math.random(),
) {
  return method !== "GET" || !isHaojiePoll(path) || status >= 400 || sample < 0.01;
}

// Only route shapes are retained; query strings, names and unknown paths are never logged.
export function performanceRoute(path: string): string {
  path = path.replace(/\.rsc$/, "") || "/";
  if (path === "/static/*") return path;
  if (/^\/(?:_next|_vinext|assets)\//.test(path)) return "/static/*";
  if (
    path === "/posts/new" ||
    path === "/posts/import" ||
    path === "/settings/profile" ||
    path === "/tags"
  )
    return path;
  if (/^\/tags\/[^/]+$/.test(path)) return "/tags/:name";
  if (/^\/notifications\/[^/]+$/.test(path)) return "/notifications/:id";
  if (/^\/admin\/revisions\/[^/]+$/.test(path)) return "/admin/revisions/:id";
  if (path === "/games/haojie" || path === "/api/haojie/rooms") return path;
  if (/^\/games\/haojie\/[^/]+$/.test(path)) return "/games/haojie/:id";
  if (/^\/api\/haojie\/rooms\/[^/]+(?:\/(?:join|commands|finish|reactions))?$/.test(path))
    return path.replace(/^(\/api\/haojie\/rooms)\/[^/]+/, "$1/:id");
  const clean = path.replace(/\/$/, "") || "/";
  if (/^\/(?:posts|users|api\/assets)\/[^/]+(?:\/(?:edit|history))?$/.test(clean))
    return clean.replace(/^(\/(?:posts|users|api\/assets))\/[^/]+/, "$1/:id");
  if (
    /^\/(?:admin(?:\/(?:posts|replies|annotations|annotation-replies|users|settings))?|notifications|search|settings|onboarding|access-denied|write|api\/(?:assets|docx-import|performance))$/.test(
      clean,
    ) ||
    clean === "/"
  )
    return clean;
  return "/other";
}

export function milliseconds(value: number): number {
  return Math.round(Math.max(0, Math.min(value, 3_600_000)) * 10) / 10;
}

export function sanitizeClientRecord(value: unknown): Record<string, string | number> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    !["resource", "navigation", "interaction", "longtask", "fetch_error", "client_error"].includes(
      String(input.kind),
    )
  )
    return null;
  const result: Record<string, string | number> = {
    kind: String(input.kind),
    route: performanceRoute(typeof input.route === "string" ? input.route : ""),
  };
  if (input.kind === "client_error") {
    if (
      typeof input.incidentId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        input.incidentId,
      )
    )
      return null;
    if (
      !["runtime", "unhandledrejection", "react", "action", "resource"].includes(
        String(input.errorSource),
      )
    )
      return null;
    result.incidentId = input.incidentId;
    result.errorSource = String(input.errorSource);
    if (
      typeof input.errorName === "string" &&
      /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError|AbortError|TimeoutError|Unknown)$/.test(
        input.errorName,
      )
    )
      result.errorName = input.errorName;
    if (
      [
        "CHUNK_LOAD_FAILED",
        "RESOURCE_LOAD_FAILED",
        "FETCH_FAILED",
        "ABORTED",
        "UNEXPECTED_ERROR",
      ].includes(String(input.errorCode))
    )
      result.errorCode = String(input.errorCode);
    if (typeof input.renderDigest === "string" && /^\d{1,10}$/.test(input.renderDigest))
      result.renderDigest = input.renderDigest;
    if (
      typeof input.frames === "string" &&
      input.frames.length <= 750 &&
      /^(?:[A-Za-z0-9_-]{1,120}\.m?js:\d{1,8}:\d{1,8})(?:\|[A-Za-z0-9_-]{1,120}\.m?js:\d{1,8}:\d{1,8}){0,4}$/.test(
        input.frames,
      )
    )
      result.frames = input.frames;
  }
  if (
    typeof input.observedAt === "number" &&
    Number.isSafeInteger(input.observedAt) &&
    Math.abs(input.observedAt - Date.now()) < 86_400_000
  )
    result.observedAt = input.observedAt;
  if (typeof input.requestId === "string" && /^[0-9a-f-]{36}$/.test(input.requestId))
    result.requestId = input.requestId;
  for (const key of ["browserId", "sessionId"]) {
    if (
      typeof input[key] === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input[key])
    )
      result[key] = input[key];
  }
  const enums: Record<string, string[]> = {
    protocol: ["h2", "h3", "http/1.1"],
    effectiveType: ["slow-2g", "2g", "3g", "4g"],
    visibility: ["visible", "hidden"],
    initiator: ["fetch", "xmlhttprequest", "script", "link", "img", "css", "navigation", "other"],
    errorType: ["aborted", "network", "other"],
    eventType: ["click", "pointerdown", "pointerup", "keydown", "keyup", "input", "other"],
  };
  for (const [key, values] of Object.entries(enums))
    if (typeof input[key] === "string" && values.includes(input[key])) result[key] = input[key];
  for (const key of [
    "durationMs",
    "preRequestMs",
    "encodedBytes",
    "decodedBytes",
    "rttMs",
    "downlinkMbps",
    "online",
    "saveData",
    "dnsMs",
    "connectMs",
    "tlsMs",
    "ttfbMs",
    "downloadMs",
    "serverMs",
    "dbMs",
    "dbCount",
    "dbTrips",
    "r2Ms",
    "r2Count",
    "transferBytes",
    "domInteractiveMs",
    "domCompleteMs",
    "inputDelayMs",
    "processingMs",
    "presentationMs",
    "status",
  ]) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000_000)
      result[key] = Math.round(value * 10) / 10;
  }
  return result;
}
