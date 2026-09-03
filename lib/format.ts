export function formatDateTime(value: Date | number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatJoinedDate(value: Date | number): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(
    value instanceof Date ? value : new Date(value),
  );
}

export function excerpt(value: string, length = 150): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return Array.from(clean).length > length
    ? `${Array.from(clean).slice(0, length).join("")}…`
    : clean;
}
