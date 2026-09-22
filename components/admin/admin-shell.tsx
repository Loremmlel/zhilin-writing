import Link from "next/link";
import type { ReactNode } from "react";

import type { AdminContentType } from "@/lib/admin/query";

export type AdminNavKey = "overview" | AdminContentType | "members" | "audit" | "games";

const contentLinks: Array<{ key: AdminContentType; label: string }> = [
  { key: "posts", label: "帖子" },
  { key: "replies", label: "回复" },
  { key: "annotations", label: "批注" },
  { key: "annotation-replies", label: "批注回复" },
];
const navLabels: Record<AdminNavKey, string> = {
  overview: "总览",
  posts: "帖子",
  replies: "回复",
  annotations: "批注",
  "annotation-replies": "批注回复",
  members: "成员与白名单",
  audit: "操作日志",
  games: "对局档案",
};

function Navigation({ active }: { active: AdminNavKey }) {
  return (
    <nav className="admin-navigation" aria-label="管理后台">
      <Link
        href="/admin"
        className={active === "overview" ? "is-active" : ""}
        aria-current={active === "overview" ? "page" : undefined}
      >
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
          {item.label}
        </Link>
      ))}
      <p>用户与安全</p>
      <Link
        href="/admin?section=members"
        className={active === "members" ? "is-active" : ""}
        aria-current={active === "members" ? "page" : undefined}
      >
        成员与白名单
      </Link>
      <p>游戏</p>
      <Link
        href="/admin/games"
        className={active === "games" ? "is-active" : ""}
        aria-current={active === "games" ? "page" : undefined}
      >
        对局档案
      </Link>
      <p>系统</p>
      <Link
        href="/admin?section=audit"
        className={active === "audit" ? "is-active" : ""}
        aria-current={active === "audit" ? "page" : undefined}
      >
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
        <summary>管理导航 · {navLabels[active]}</summary>
        <Navigation active={active} />
      </details>
      <div className="admin-shell-main">{children}</div>
    </div>
  );
}
