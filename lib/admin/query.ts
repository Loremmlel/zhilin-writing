export const ADMIN_PAGE_SIZE = 20;

export type AdminContentType = "posts" | "replies" | "annotations" | "annotation-replies";
export type AdminContentStatus = "normal" | "deleted" | "hidden";
export type AdminSort = "newest" | "oldest";
export type AdminSection = "overview" | "content" | "members" | "audit";

export type RawAdminQuery = Record<string, string | string[] | undefined>;

export type AdminView = {
  section: AdminSection;
  type: AdminContentType;
  status: AdminContentStatus;
  q: string;
  sort: AdminSort;
  page: number;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAdminQuery(query: RawAdminQuery): AdminView {
  const rawType = first(query.type);
  const type: AdminContentType =
    rawType === "replies" || rawType === "annotations" || rawType === "annotation-replies"
      ? rawType
      : "posts";
  const rawStatus = first(query.status);
  const status: AdminContentStatus =
    rawStatus === "deleted" || rawStatus === "hidden" ? rawStatus : "normal";
  const rawSection = first(query.section);
  const section: AdminSection =
    rawSection === "members" || rawSection === "audit" || rawSection === "overview"
      ? rawSection
      : rawType
        ? "content"
        : "overview";
  const q = (first(query.q) ?? "").trim().slice(0, 100);
  const sort: AdminSort = first(query.sort) === "oldest" ? "oldest" : "newest";
  const rawPage = Number.parseInt(first(query.page) ?? "1", 10);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  return { section, type, status, q, sort, page };
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
  } else {
    params.set("section", next.section);
  }
  if (next.page > 1) params.set("page", String(next.page));
  return `/admin?${params.toString()}`;
}

export type AdminListOptions = Pick<AdminView, "status" | "q" | "sort" | "page"> & {
  pageSize?: number;
};

export type AdminPageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminStatusCounts = Record<AdminContentStatus, number>;
