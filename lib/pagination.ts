export const PAGE_SIZE = 20;

export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };

export function parsePage(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

export function pageBounds(total: number, requested = 1) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  return { total, page, pageSize: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}

export function pageHref(path: string, filters: Record<string, string | undefined>, page = 1) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (page > 1) params.set("page", String(page));
  return `${path}${params.size ? `?${params}` : ""}`;
}

export function paginationPages(page: number, pages: number): (number | "gap")[] {
  const visible = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((value) => value >= 1 && value <= pages)
    .sort((a, b) => a - b);
  return visible.flatMap((value, index) =>
    index && value - visible[index - 1] > 1 ? ["gap" as const, value] : [value],
  );
}
