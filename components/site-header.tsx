import Link from "next/link";

import type { SiteUser } from "@/db/schema";
import { AccountMenu } from "./account-menu";

export function SiteHeader({ member, isAdmin, unreadCount }: { member: SiteUser; isAdmin: boolean; unreadCount: number }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="知临中学首页">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M8 23c7-1 13-6 16-15-8 1-14 6-16 15Z" fill="currentColor" opacity=".9" />
            <path d="M9 24c5-7 9-11 15-15M12 17c-3-1-5-3-6-6 4 0 7 1 9 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span className="brand-name">知临中学</span>
          <span className="brand-subtitle">私人 Markdown 写作社区</span>
        </Link>
        <form action="/search" className="header-search" role="search" noValidate>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          <input name="q" aria-label="搜索帖子" placeholder="搜索帖子标题或正文" />
        </form>
        <nav className="header-actions" aria-label="主导航">
          <Link href="/notifications" className="notification-link" aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            {unreadCount > 0 && <span>{unreadCount > 99 ? "99+" : unreadCount}</span>}
          </Link>
          <Link href="/posts/new" className="button button--primary button--write">写帖子</Link>
          <AccountMenu member={member} isAdmin={isAdmin} />
        </nav>
      </div>
    </header>
  );
}
