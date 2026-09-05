export function formatDateTime(value: Date | number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatJoinedDate(value: Date | number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
  }).format(value instanceof Date ? value : new Date(value));
}

export function excerpt(value: string, length = 150): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return Array.from(clean).length > length
    ? `${Array.from(clean).slice(0, length).join("")}…`
    : clean;
}

export function formatListDateTime(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" });
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: year.format(date) === year.format(new Date()) ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
