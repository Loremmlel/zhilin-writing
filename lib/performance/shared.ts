export const PERFORMANCE_ENDPOINT = "/api/performance";
export const MAX_BATCH = 30;

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
    !["resource", "navigation", "interaction", "longtask", "fetch_error"].includes(
      String(input.kind),
    )
  )
    return null;
  const result: Record<string, string | number> = {
    kind: String(input.kind),
    route: performanceRoute(typeof input.route === "string" ? input.route : ""),
  };
  if (
    typeof input.observedAt === "number" &&
    Number.isSafeInteger(input.observedAt) &&
    Math.abs(input.observedAt - Date.now()) < 86_400_000
  )
    result.observedAt = input.observedAt;
  if (typeof input.requestId === "string" && /^[0-9a-f-]{36}$/.test(input.requestId))
    result.requestId = input.requestId;
  for (const key of [
    "durationMs",
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
