export const ADMIN_PAGE_SIZE = 20;

export type AdminContentType = "posts" | "replies" | "annotations" | "annotation-replies";
export type AdminContentStatus = "all" | "normal" | "deleted" | "hidden";
export type AdminSort = "newest" | "oldest";
export type AdminSection = "overview" | "content" | "members" | "audit";

export type RawAdminQuery = Record<string, string | string[] | undefined>;

export type AdminView = {
  section: AdminSection;
  type: AdminContentType;
  status: AdminContentStatus;
  q: string;
  sort: AdminSort;
  from: string;
  to: string;
  page: number;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dateOnly(value: string | undefined): string {
  const candidate = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
    ? candidate
    : "";
}

export function parseAdminQuery(query: RawAdminQuery): AdminView {
  const rawType = first(query.type);
  const type: AdminContentType =
    rawType === "replies" || rawType === "annotations" || rawType === "annotation-replies"
      ? rawType
      : "posts";
  const rawStatus = first(query.status);
  const status: AdminContentStatus =
    rawStatus === "all" || rawStatus === "deleted" || rawStatus === "hidden" ? rawStatus : "normal";
  const rawSection = first(query.section);
  const section: AdminSection =
    rawSection === "members" || rawSection === "audit" || rawSection === "overview"
      ? rawSection
      : rawType
        ? "content"
        : "overview";
  const q = (first(query.q) ?? "").trim().slice(0, 100);
  const sort: AdminSort = first(query.sort) === "oldest" ? "oldest" : "newest";
  let from = dateOnly(first(query.from));
  let to = dateOnly(first(query.to));
  if (from && to && from > to) [from, to] = [to, from];
  const rawPage = Number.parseInt(first(query.page) ?? "1", 10);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  return { section, type, status, q, sort, from, to, page };
}

export function adminUrl(view: AdminView, changes: Partial<AdminView> = {}): string {
  const next = { ...view, ...changes };
  if (next.section === "overview") return "/admin";
  const params = new URLSearchParams();
  if (next.section === "content") {
    params.set("type", next.type);
    params.set("status", next.status);
    if (next.q) params.set("q", next.q);
    if (next.sort !== "newest") params.set("sort", next.sort);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
  } else {
    params.set("section", next.section);
  }
  if (next.page > 1) params.set("page", String(next.page));
  return `/admin?${params.toString()}`;
}

export type AdminListOptions = Pick<AdminView, "status" | "q" | "sort" | "from" | "to" | "page"> & {
  pageSize?: number;
};

export function adminDateBounds(options: Pick<AdminView, "from" | "to">) {
  const start = options.from ? new Date(`${options.from}T00:00:00+08:00`) : null;
  const endExclusive = options.to
    ? new Date(new Date(`${options.to}T00:00:00+08:00`).getTime() + 86_400_000)
    : null;
  return { start, endExclusive };
}

export type AdminPageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminStatusCounts = Record<AdminContentStatus, number>;
