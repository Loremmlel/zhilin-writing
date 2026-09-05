import Link from "next/link";
import { pageHref, paginationPages } from "@/lib/pagination";

export function Pagination({
  total,
  page,
  pageSize,
  path,
  filters = {},
}: {
  total: number;
  page: number;
  pageSize: number;
  path: string;
  filters?: Record<string, string | undefined>;
}) {
  if (!total) return null;
  const pages = Math.ceil(total / pageSize);
  const href = (value: number) => pageHref(path, filters, value);
  return (
    <div className="pagination-row">
      <span className="muted">
        第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条，共 {total} 条
      </span>
      {pages > 1 && (
        <nav className="pagination" aria-label="分页">
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev">
              上一页
            </Link>
          ) : (
            <span aria-disabled="true">上一页</span>
          )}
          {paginationPages(page, pages).map((value, index) =>
            value === "gap" ? (
              <span key={`gap-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <Link
                key={value}
                href={href(value)}
                aria-label={`第 ${value} 页`}
                aria-current={value === page ? "page" : undefined}
              >
                {value}
              </Link>
            ),
          )}
          {page < pages ? (
            <Link href={href(page + 1)} rel="next">
              下一页
            </Link>
          ) : (
            <span aria-disabled="true">下一页</span>
          )}
        </nav>
      )}
    </div>
  );
}
