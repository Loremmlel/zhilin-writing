import { redirect } from "next/navigation";
import { pageHref } from "./pagination";

export function canonicalPage(
  raw: unknown,
  page: number,
  path: string,
  filters: Record<string, string | undefined> = {},
) {
  if (raw !== undefined && raw !== String(page)) redirect(pageHref(path, filters, page));
}
