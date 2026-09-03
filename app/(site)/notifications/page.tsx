import Link from "next/link";
import { Suspense } from "react";

import { NotificationsListSkeleton } from "@/components/loading/skeletons";
import { NotificationList } from "@/components/notification-list";
import { MarkAllNotificationsForm } from "@/components/notifications/mark-all-notifications-form";
import { RegionErrorBoundary } from "@/components/region-error-boundary";
import { listNotifications } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";
import { markAllNotificationsReadAction } from "./actions";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ member }, params] = await Promise.all([requireMember("/notifications"), searchParams]);
  const unreadOnly = params.tab === "unread";
  return <div className="page-column notifications-page">
    <header className="page-header notification-header">
      <div><span className="eyebrow">只属于你的消息</span><h1>通知</h1><p>这里显示别人对你的内容作出的直接回应，以及 DOCX 导入时与你关联的 Word 批注。</p></div>
      <MarkAllNotificationsForm action={markAllNotificationsReadAction} />
    </header>
    <nav className="list-tabs" aria-label="通知筛选">
      <Link href="/notifications" className={!unreadOnly ? "is-active" : ""}>全部</Link>
      <Link href="/notifications?tab=unread" className={unreadOnly ? "is-active" : ""}>未读</Link>
    </nav>
    <RegionErrorBoundary title="通知暂时无法载入" description="筛选条件仍会保留，请稍后重试。">
      <Suspense fallback={<NotificationsListSkeleton />}>
        <NotificationsRegion memberId={member.id} unreadOnly={unreadOnly} />
      </Suspense>
    </RegionErrorBoundary>
  </div>;
}

async function NotificationsRegion({ memberId, unreadOnly }: { memberId: string; unreadOnly: boolean }) {
  const items = await listNotifications(memberId, { unreadOnly });
  return <NotificationList items={items} emptyKind={unreadOnly ? "unread" : "all"} />;
}
