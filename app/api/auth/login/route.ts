import { env } from "cloudflare:workers";
import { passwordLogin } from "@/lib/auth/password-service";
import {
  isSameOriginMutation,
  safeReturnPath,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "@/lib/auth/password-policy";
import { measuredDatabase } from "@/lib/performance/server";
import { logServerError } from "@/lib/logging";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isSameOriginMutation(request))
    return Response.json({ error: "请从本站登录页重试。" }, { status: 403, headers });
  let input: Record<string, unknown>;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error();
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    input = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.email !== "string" ||
      input.email.length > 254 ||
      typeof input.password !== "string" ||
      Array.from(input.password).length > 128 ||
      !input.password
    )
      throw new Error();
  } catch {
    return Response.json({ error: "请输入邮箱和密码。" }, { status: 400, headers });
  }
  try {
    const result = await passwordLogin(
      measuredDatabase(env.DB),
      input.email as string,
      input.password as string,
      request.headers.get("cf-connecting-ip") ?? "unknown",
    );
    if (!result.ok)
      return Response.json(
        {
          error: result.limited
            ? "尝试次数过多，请 15 分钟后再试。"
            : "邮箱或密码不正确，或该邮箱未获邀请。",
        },
        {
          status: result.limited ? 429 : 401,
          headers: { ...headers, ...(result.limited ? { "Retry-After": "900" } : {}) },
        },
      );
    return Response.json(
      { returnTo: safeReturnPath(input.returnTo) },
      {
        headers: {
          ...headers,
          "Set-Cookie": `${SESSION_COOKIE}=${result.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
        },
      },
    );
  } catch (error) {
    const incidentId = logServerError({
      operation: "auth.password-login",
      error,
      errorCode: "PASSWORD_LOGIN_FAILED",
    });
    return Response.json(
      { error: "暂时无法登录，请稍后重试。", incidentId },
      { status: 500, headers },
    );
  }
}
