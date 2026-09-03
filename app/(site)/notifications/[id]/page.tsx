import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { findOwnedNotification, markNotificationRead } from "@/db/queries";
import { annotationReplyTargetHref, annotationTargetHref, replyTargetHref } from "@/lib/activity/policy";
import { requireMember } from "@/lib/auth/access";
import { formatDocxAttributionNotice } from "@/lib/notifications/policy";
import { notificationTargetNotice, targetHrefWithNotice } from "@/lib/notifications/target-resolution";

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

  const resolution = item.targetResolution;
  if (!resolution) notFound();
  if (!item.post || resolution.state === "POST_UNAVAILABLE" || resolution.state === "NOT_FOUND") {
    const copy = resolution.state === "AVAILABLE" ? "没有找到这条通知关联的内容。" : notificationTargetNotice(resolution.state, resolution.kind);
    return <div className="page-column"><div className="unavailable-card"><span className="eyebrow">历史通知</span><h1>无法打开通知目标</h1><p>{copy}</p></div></div>;
  }

  const targetHref = resolution.kind === "POST_REPLY" && item.notification.replyId
    ? replyTargetHref(item.post.id, item.notification.replyId)
    : resolution.kind === "ANNOTATION" && item.notification.annotationId
      ? annotationTargetHref(item.post.id, item.notification.annotationId)
      : resolution.kind === "ANNOTATION_REPLY" && item.notification.annotationId && item.notification.annotationReplyId
        ? annotationReplyTargetHref(item.post.id, item.notification.annotationId, item.notification.annotationReplyId)
        : null;
  if (!targetHref) notFound();
  redirect(resolution.state === "AVAILABLE" ? targetHref : targetHrefWithNotice(targetHref, resolution.state));
}
