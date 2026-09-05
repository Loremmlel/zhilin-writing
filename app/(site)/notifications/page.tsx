import Link from "next/link";
import { Suspense } from "react";

import { NotificationsListSkeleton } from "@/components/loading/skeletons";
import { NotificationList } from "@/components/notification-list";
import { MarkAllNotificationsForm } from "@/components/notifications/mark-all-notifications-form";
import { RegionErrorBoundary } from "@/components/region-error-boundary";
import { listNotificationsPage } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";
import { markAllNotificationsReadAction } from "./actions";

import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { parsePage } from "@/lib/pagination";
import { canonicalPage } from "@/lib/page-navigation";
export const metadata = { title: "通知" };
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const [{ member }, params] = await Promise.all([requireMember("/notifications"), searchParams]);
  const unreadOnly = params.tab === "unread";
  return (
    <div className="page-column notifications-page">
      <PageHeader
        title="通知"
        actions={<MarkAllNotificationsForm action={markAllNotificationsReadAction} />}
      />
      <div className="notification-inner">
        <nav className="list-tabs" aria-label="通知筛选">
          <Link href="/notifications" className={!unreadOnly ? "is-active" : ""}>
            全部
          </Link>
          <Link href="/notifications?tab=unread" className={unreadOnly ? "is-active" : ""}>
            未读
          </Link>
        </nav>
        <RegionErrorBoundary title="通知暂时无法载入" description="筛选条件仍会保留，请稍后重试。">
          <Suspense fallback={<NotificationsListSkeleton />}>
            <NotificationsRegion
              memberId={member.id}
              unreadOnly={unreadOnly}
              rawPage={params.page}
            />
          </Suspense>
        </RegionErrorBoundary>
      </div>
    </div>
  );
}

async function NotificationsRegion({
  memberId,
  unreadOnly,
  rawPage,
}: {
  memberId: string;
  unreadOnly: boolean;
  rawPage?: string;
}) {
  const result = await listNotificationsPage(memberId, { unreadOnly, page: parsePage(rawPage) });
  const filters = { tab: unreadOnly ? "unread" : undefined };
  canonicalPage(rawPage, result.page, "/notifications", filters);
  return (
    <>
      <NotificationList items={result.items} emptyKind={unreadOnly ? "unread" : "all"} />
      <Pagination {...result} path="/notifications" filters={filters} />
    </>
  );
}
