import { isIP } from "node:net";

// Coarse network groups are diagnostic hints, not device identities or auth inputs.
export function requestEnvironment(request: Request): Record<string, string | number> {
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 512);
  const browsers = [
    ["edge", /Edg(?:A|iOS)?\/(\d+)/],
    ["opera", /OPR\/(\d+)/],
    ["firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["safari", /Version\/(\d+).*Safari/],
  ] as const;
  const match = browsers
    .map(([name, pattern]) => [name, ua.match(pattern)?.[1]] as const)
    .find(([, version]) => version);
  const result: Record<string, string | number> = {
    probeVersion: 3,
    browser: match?.[0] ?? "other",
    deviceType:
      /iPad|Tablet/i.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
        ? "tablet"
        : /Mobile|iPhone/i.test(ua)
          ? "mobile"
          : "desktop",
    os: /Android/.test(ua)
      ? "android"
      : /iPhone|iPad/.test(ua)
        ? "ios"
        : /Windows/.test(ua)
          ? "windows"
          : /Macintosh/.test(ua)
            ? "macos"
            : /Linux/.test(ua)
              ? "linux"
              : "other",
  };
  if (match?.[1]) result.browserMajor = Number(match[1]);
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  if (isIP(ip) === 4) result.networkPrefix = ip.split(".").slice(0, 3).join(".") + ".0/24";
  else if (isIP(ip) === 6 && !ip.includes(".")) {
    const [left, right] = ip.split("::");
    const a = left ? left.split(":") : [],
      b = right ? right.split(":") : [];
    const parts = ip.includes("::") ? [...a, ...Array(8 - a.length - b.length).fill("0"), ...b] : a;
    result.networkPrefix =
      parts
        .slice(0, 3)
        .map((part) => parseInt(part, 16).toString(16))
        .join(":") + "::/48";
  }
  const cf = (request as Request & { cf?: { colo?: string; country?: string } }).cf;
  const country = cf?.country ?? request.headers.get("cf-ipcountry");
  if (country && /^[A-Z]{2}$/.test(country)) result.country = country;
  if (cf?.colo && /^[A-Z]{3}$/.test(cf.colo)) result.colo = cf.colo;
  result.prefetch =
    request.headers.get("next-router-prefetch") === "1" ||
    /prefetch/i.test(request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "")
      ? 1
      : 0;
  return result;
}
