import { requestEnvironment } from "@/lib/performance/environment";
import { env } from "cloudflare:workers";
import { getApiMemberAccess, getActionAdministratorAccess } from "@/lib/auth/access";
import { MAX_BATCH, sanitizeClientRecord } from "@/lib/performance/shared";
import { savePerformance } from "@/lib/performance/server";
import { logServerError } from "@/lib/logging";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return new Response(null, { status: 415 });
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return new Response(null, { status: access.status });
    // Bound bytes while reading, including chunked bodies without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    let size = 0;
    let body = "";
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 24_000) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!Array.isArray(data) || data.length > MAX_BATCH) return new Response(null, { status: 400 });
    const records = data.map(sanitizeClientRecord);
    if (records.some((record) => !record)) return new Response(null, { status: 400 });
    const environment = requestEnvironment(request);
    await savePerformance(
      env.DB,
      "client",
      records.map((record) => ({ ...record, ...environment })),
    );
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const incidentId = logServerError({
      operation: "performance.ingest",
      error,
      errorCode: "PERFORMANCE_INGEST_FAILED",
    });
    return Response.json({ incidentId }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const access = await getActionAdministratorAccess();
    if (!access.ok) return new Response(null, { status: access.status });
    const id = new URL(request.url).searchParams.get("requestId");
    if (id && !/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 400 });
    const query = id
      ? env.DB.prepare(
          "SELECT * FROM performance_logs WHERE request_id = ? ORDER BY id DESC LIMIT 200",
        ).bind(id)
      : env.DB.prepare("SELECT * FROM performance_logs ORDER BY id DESC LIMIT 200");
    const { results } = await query.all();
    return Response.json(
      {
        limit: 5000,
        records: results.map((row) => ({ ...row, record: JSON.parse(String(row.record)) })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const incidentId = logServerError({
      operation: "performance.read",
      error,
      errorCode: "PERFORMANCE_READ_FAILED",
    });
    return Response.json({ incidentId }, { status: 500 });
  }
}
