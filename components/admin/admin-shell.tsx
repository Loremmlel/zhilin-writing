import Link from "next/link";
import type { ReactNode } from "react";

import type { AdminContentType } from "@/lib/admin/query";

export type AdminNavKey = "overview" | AdminContentType | "members" | "audit";

const contentLinks: Array<{ key: AdminContentType; label: string; mark: string }> = [
  { key: "posts", label: "帖子", mark: "帖" },
  { key: "replies", label: "回复", mark: "回" },
  { key: "annotations", label: "批注", mark: "批" },
  { key: "annotation-replies", label: "批注回复", mark: "答" },
];

function Navigation({ active }: { active: AdminNavKey }) {
  return (
    <nav className="admin-navigation" aria-label="管理后台">
      <Link
        href="/admin"
        className={active === "overview" ? "is-active" : ""}
        aria-current={active === "overview" ? "page" : undefined}
      >
        <span aria-hidden="true">总</span>
        总览
      </Link>
      <p>内容管理</p>
      {contentLinks.map((item) => (
        <Link
          key={item.key}
          href={`/admin?type=${item.key}&status=normal`}
          className={active === item.key ? "is-active" : ""}
          aria-current={active === item.key ? "page" : undefined}
        >
          <span aria-hidden="true">{item.mark}</span>
          {item.label}
        </Link>
      ))}
      <p>用户与安全</p>
      <Link
        href="/admin?section=members"
        className={active === "members" ? "is-active" : ""}
        aria-current={active === "members" ? "page" : undefined}
      >
        <span aria-hidden="true">员</span>
        成员与白名单
      </Link>
      <p>系统</p>
      <Link
        href="/admin?section=audit"
        className={active === "audit" ? "is-active" : ""}
        aria-current={active === "audit" ? "page" : undefined}
      >
        <span aria-hidden="true">志</span>
        操作日志
      </Link>
    </nav>
  );
}

export function AdminShell({ active, children }: { active: AdminNavKey; children: ReactNode }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Navigation active={active} />
      </aside>
      <details className="admin-mobile-navigation">
        <summary>管理导航</summary>
        <Navigation active={active} />
      </details>
      <div className="admin-shell-main">{children}</div>
    </div>
  );
}
