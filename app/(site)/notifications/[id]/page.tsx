import { notFound, redirect } from "next/navigation";

import { findOwnedNotification, markNotificationRead } from "@/db/queries";
import { replyTargetHref } from "@/lib/activity/policy";
import { requireMember } from "@/lib/auth/access";

export default async function OpenNotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { member } = await requireMember(`/notifications/${id}`);
  const item = await findOwnedNotification(id, member.id);
  if (!item) notFound();
  await markNotificationRead(id, member.id);

  if (!item.postReachable || !item.post) {
    return <div className="page-column"><div className="unavailable-card"><span className="eyebrow">历史通知</span><h1>该内容已不可用。</h1><p>通知记录仍然保留，但关联的帖子已经删除、隐藏或不再可访问。</p></div></div>;
  }
  if (item.notification.replyId && item.replyAvailable) {
    redirect(replyTargetHref(item.post.id, item.notification.replyId));
  }
  const notice = item.replyState === "hidden" ? "reply-hidden" : "reply-deleted";
  redirect(`/posts/${item.post.id}?notice=${notice}#replies`);
}
