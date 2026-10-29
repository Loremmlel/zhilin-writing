import { POST as exportBackup, GET as rejectBackupGet } from "../app/api/admin/backup/route";
import { requestEnvironment } from "../lib/performance/environment";
import {
  requestPerformance,
  savePerformance,
  observeResponseBody,
} from "../lib/performance/server";
import {
  performanceRoute,
  milliseconds,
  PERFORMANCE_ENDPOINT,
  shouldSamplePerformance,
} from "../lib/performance/shared";
/** Cloudflare Worker entry point for the vinext-starter template. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { isSameOriginMutation, SESSION_COOKIE } from "../lib/auth/password-policy";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers
        .get("cookie")
        ?.split(";")
        .some((cookie) => cookie.trim().startsWith(`${SESSION_COOKIE}=`)) &&
      !isSameOriginMutation(request)
    )
      return new Response("请从本站重试。", { status: 403 });

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-zhilin-request-path", `${url.pathname}${url.search}`);
    return handler.fetch(new Request(request, { headers: requestHeaders }), env, ctx);
  },
};

const observedWorker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === PERFORMANCE_ENDPOINT) return worker.fetch(request, env, ctx);
    // Keep FixedLengthStream intact: Vinext/body telemetry wrapping masks truncated downloads.
    // The handler performs the same server-side administrator and same-origin checks.
    if (url.pathname === "/api/admin/backup")
      return request.method === "POST" ? exportBackup(request) : rejectBackupGet();
    const environment = requestEnvironment(request);
    const context: NonNullable<ReturnType<typeof requestPerformance.getStore>> = {
      requestId: crypto.randomUUID(),
      dbMs: 0,
      dbCount: 0,
      dbTrips: 0,
      operation: undefined as string | undefined,
      r2Ms: 0,
      r2Count: 0,
    };
    return requestPerformance.run(context, async () => {
      const started = performance.now();
      let status = 500;
      let sampled = true;
      try {
        const response = await worker.fetch(request, env, ctx);
        status = response.status;
        sampled = shouldSamplePerformance(request.method, url.pathname, status);
        const headers = new Headers(response.headers);
        headers.append(
          "Server-Timing",
          `app;dur=${milliseconds(performance.now() - started)}, db;dur=${milliseconds(context.dbMs)}, dbcount;dur=${context.dbCount}, dbtrips;dur=${context.dbTrips}, r2;dur=${milliseconds(context.r2Ms)}, r2count;dur=${context.r2Count}, request;desc="${context.requestId}"`,
        );
        headers.set("X-Request-Id", context.requestId);
        if (!sampled) headers.append("Server-Timing", 'telemetry;desc="skip"');
        const body = response.body
          ? observeResponseBody(response.body, (outcome) => {
              if (!sampled && outcome !== "error") return;
              ctx.waitUntil(
                savePerformance(env.DB, "server", [
                  {
                    ...environment,
                    requestId: context.requestId,
                    route: performanceRoute(url.pathname),
                    phase: "stream_end",
                    outcome,
                    status,
                    streamEndMs: milliseconds(performance.now() - started),
                    dbMs: milliseconds(context.dbMs),
                    dbCount: context.dbCount,
                    dbTrips: context.dbTrips,
                    dbSqlMs: context.dbSqlMs,
                    dbMetaCount: context.dbMetaCount,
                    dbRowsRead: context.dbRowsRead,
                    dbRowsWritten: context.dbRowsWritten,
                    dbAttempts: context.dbAttempts,
                    dbRegion: context.dbRegion,
                    operation: context.operation,
                    incidentId: context.incidentId,
                    r2Ms: milliseconds(context.r2Ms),
                    r2Count: context.r2Count,
                  },
                ]),
              );
            })
          : null;
        return new Response(body, { status, statusText: response.statusText, headers });
      } finally {
        const record = {
          ...environment,
          requestId: context.requestId,
          route: performanceRoute(url.pathname),
          method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
            request.method,
          )
            ? request.method
            : "OTHER",
          kind:
            request.headers.has("x-rsc-action") || request.headers.has("next-action")
              ? "action"
              : request.headers.get("RSC") === "1"
                ? "rsc"
                : "http",
          status,
          phase: "response_ready",
          responseReadyMs: milliseconds(performance.now() - started),
          dbMs: milliseconds(context.dbMs),
          dbCount: context.dbCount,
          dbTrips: context.dbTrips,
          dbSqlMs: context.dbSqlMs,
          dbMetaCount: context.dbMetaCount,
          dbRowsRead: context.dbRowsRead,
          dbRowsWritten: context.dbRowsWritten,
          dbAttempts: context.dbAttempts,
          dbRegion: context.dbRegion,
          operation: context.operation,
          incidentId: context.incidentId,
          r2Ms: milliseconds(context.r2Ms),
          r2Count: context.r2Count,
        };
        if (sampled) ctx.waitUntil(savePerformance(env.DB, "server", [record]));
      }
    });
  },
};

export default observedWorker;
