// Temporary, credential-gated transport experiment; remove after production verification.
export const TRANSPORT_PROBE_PATH = "/api/admin/transport-probe";
const EXPIRES = Date.parse("2026-09-19T08:30:00Z");
let instance: string | undefined;

export async function transportProbe(
  request: Request,
  env: { SITES_TRANSPORT_PROBE_TOKEN?: string },
): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Transport-Probe": "v1" };
  if (Date.now() > EXPIRES || !env.SITES_TRANSPORT_PROBE_TOKEN)
    return new Response(null, { status: 404, headers });
  if (request.headers.get("Authorization") !== `Bearer ${env.SITES_TRANSPORT_PROBE_TOKEN}`)
    return new Response(null, { status: 403, headers });
  if (request.method !== "GET") return new Response(null, { status: 405, headers });
  instance ??= crypto.randomUUID();

  const url = new URL(request.url);
  if (url.searchParams.get("selftest") === "1") {
    // Same public Sites gateway, but initiated from Workers to distinguish client proxy failures.
    url.search = "";
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${env.SITES_TRANSPORT_PROBE_TOKEN}`, Upgrade: "websocket" },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    const socket = upstream.webSocket;
    if (!socket)
      return Response.json({ upstreamStatus: upstream.status, upgraded: false }, { headers });
    socket.accept();
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 8000);
      socket.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data));
        if (data.type === "echo" && data.text === "server-selftest") {
          clearTimeout(timer);
          resolve("echo-received");
        }
      });
      socket.send("server-selftest");
    });
    socket.close(1000, "selftest complete");
    return Response.json({ upstreamStatus: upstream.status, upgraded: true, outcome }, { headers });
  }

  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return Response.json(
      { probe: "v1", webSocketPair: typeof WebSocketPair, instance },
      { headers },
    );

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const started = Date.now();
  let count = 0;
  const timer = setTimeout(() => server.close(1000, "probe time limit"), 90000);
  server.addEventListener("close", () => clearTimeout(timer));
  server.addEventListener("error", () => clearTimeout(timer));
  server.addEventListener("message", (event) => {
    if (typeof event.data !== "string" || event.data.length > 128 || ++count > 8) {
      server.close(1008, "probe message limit");
      return;
    }
    server.send(
      JSON.stringify({
        type: "echo",
        text: event.data,
        count,
        elapsedMs: Date.now() - started,
        instance,
      }),
    );
  });
  server.send(JSON.stringify({ type: "ready", instance }));
  return new Response(null, { status: 101, webSocket: client, headers });
}
