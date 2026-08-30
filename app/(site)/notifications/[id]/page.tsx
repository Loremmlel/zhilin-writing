import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { findOwnedNotification, markNotificationRead } from "@/db/queries";
import { annotationTargetHref, replyTargetHref } from "@/lib/activity/policy";
import { requireMember } from "@/lib/auth/access";
import { formatDocxAttributionNotice } from "@/lib/notifications/policy";

export default async function OpenNotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { member } = await requireMember(`/notifications/${id}`);
  const item = await findOwnedNotification(id, member.id);
  if (!item) notFound();
  await markNotificationRead(id, member.id);

  if (item.notification.notificationType === "DOCX_ATTRIBUTION_NOTICE" && item.postReachable && item.post) {
    return <div className="page-column notifications-page">
      <div className="unavailable-card">
        <span className="eyebrow">DOCX 批注关联</span>
        <h1>Word 批注已关联到你</h1>
        <p>{item.docxAttribution
          ? formatDocxAttributionNotice(item.docxAttribution, { includePostTitle: item.postAvailable })
          : "这条 DOCX 批注关联通知的数据不完整，无法显示原始汇总。"}</p>
        <Link className="button button--primary" href={`/posts/${encodeURIComponent(item.post.id)}`}>查看帖子</Link>
      </div>
    </div>;
  }

  if (!item.postReachable || !item.post) {
    return <div className="page-column"><div className="unavailable-card"><span className="eyebrow">历史通知</span><h1>该内容已不可用。</h1><p>通知记录仍然保留，但关联的帖子已经删除、隐藏或不再可访问。</p></div></div>;
  }
  if (item.notification.replyId && item.replyAvailable) {
    redirect(replyTargetHref(item.post.id, item.notification.replyId));
  }
  if (item.notification.annotationId) {
    if (item.annotationCurrent) redirect(annotationTargetHref(item.post.id, item.notification.annotationId));
    redirect(`/posts/${item.post.id}?notice=annotation-unavailable`);
  }
  const notice = item.replyState === "hidden" ? "reply-hidden" : "reply-deleted";
  redirect(`/posts/${item.post.id}?notice=${notice}#replies`);
}
