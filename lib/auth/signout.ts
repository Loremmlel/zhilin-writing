import { env } from "cloudflare:workers";
import { passwordSessionToken } from "./password-session";
import { hashSessionToken } from "./password-service";
import { isSameOriginMutation, SESSION_COOKIE } from "./password-policy";
import { measuredDatabase } from "@/lib/performance/server";
import { logServerError } from "@/lib/logging";

export async function clearPasswordSession(request: Request, destination: string) {
  if (!isSameOriginMutation(request)) return new Response("请从本站重试。", { status: 403 });
  const token = await passwordSessionToken();
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    try {
      await measuredDatabase(env.DB)
        .prepare("DELETE FROM member_sessions WHERE token_hash=?")
        .bind(hashSessionToken(token))
        .run();
    } catch (error) {
      logServerError({ operation: "auth.signout", error, errorCode: "PASSWORD_SIGNOUT_FAILED" });
    }
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination,
      "Cache-Control": "private, no-store",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
