export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const SESSION_COOKIE = "__Host-zhilin-session";
export const SESSION_SECONDS = 14 * 24 * 60 * 60;

export function passwordError(password: string) {
  const length = Array.from(password).length;
  return length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH
    ? "密码须为 12–128 个字符"
    : null;
}

export function loginPath(returnTo = "/") {
  return `/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    if (
      url.origin !== "https://app.local" ||
      /^\/(?:login|logout|signin-with-chatgpt|signout-with-chatgpt|callback|api)(?:\/|$)/.test(
        url.pathname,
      )
    )
      return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function isSameOriginMutation(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
