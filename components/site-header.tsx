import Link from "next/link";

import type { SiteUser } from "@/db/schema";
import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { Avatar } from "./avatar";

export function SiteHeader({ member, isAdmin }: { member: SiteUser; isAdmin: boolean }) {
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
        <form action="/search" className="header-search" role="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          <input name="q" aria-label="搜索帖子" placeholder="搜索帖子标题或正文" />
        </form>
        <nav className="header-actions" aria-label="主导航">
          <Link href="/posts/new" className="button button--primary button--write">写帖子</Link>
          <details className="account-menu">
            <summary><Avatar name={member.displayName} assetId={member.avatarAssetId} size="small" /><span>{member.displayName}</span></summary>
            <div className="account-popover">
              <Link href={`/users/${member.id}`}>我的主页</Link>
              <Link href="/settings/profile">编辑资料</Link>
              <Link href="/tags">全部标签</Link>
              {isAdmin && <Link href="/admin">管理邀请</Link>}
              <a href={chatGPTSignOutPath("/")}>退出登录</a>
            </div>
          </details>
        </nav>
      </div>
    </header>
  );
}
