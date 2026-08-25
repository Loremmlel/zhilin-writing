import Link from "next/link";

import { NotificationList } from "@/components/notification-list";
import { listNotifications } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";
import { markAllNotificationsReadAction } from "./actions";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ member }, params] = await Promise.all([requireMember("/notifications"), searchParams]);
  const unreadOnly = params.tab === "unread";
  const items = await listNotifications(member.id, { unreadOnly });
  return <div className="page-column notifications-page">
    <header className="page-header notification-header">
      <div><span className="eyebrow">只属于你的消息</span><h1>通知</h1><p>这里仅显示别人对你的帖子和回复作出的直接回应。</p></div>
      <form action={markAllNotificationsReadAction}><button className="button button--ghost button--small">全部标记已读</button></form>
    </header>
    <nav className="list-tabs" aria-label="通知筛选">
      <Link href="/notifications" className={!unreadOnly ? "is-active" : ""}>全部</Link>
      <Link href="/notifications?tab=unread" className={unreadOnly ? "is-active" : ""}>未读</Link>
    </nav>
    <NotificationList items={items} />
  </div>;
}
