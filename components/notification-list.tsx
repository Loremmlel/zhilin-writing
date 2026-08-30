import Link from "next/link";

import { Avatar } from "@/components/avatar";
import type { listNotifications } from "@/db/queries";
import { truncateActivityPreview } from "@/lib/activity/policy";
import { formatDateTime } from "@/lib/format";
import { markdownToPlainText } from "@/lib/markdown/render";
import { formatDocxAttributionNotice } from "@/lib/notifications/policy";

type NotificationItem = Awaited<ReturnType<typeof listNotifications>>[number];

export function NotificationList({ items }: { items: NotificationItem[] }) {
  if (items.length === 0) return <div className="empty-state"><h2>这里很安静</h2><p>有同学回复你的内容，或 DOCX 导入关联了你的 Word 批注后，会在这里通知你。</p></div>;
  return <section className="notification-list" aria-label="通知列表">
    {items.map((item) => {
      const isUnread = !item.notification.readAt;
      const isDocxAttribution = item.notification.notificationType === "DOCX_ATTRIBUTION_NOTICE";
      const annotationNotification = !isDocxAttribution && item.notification.notificationType !== "POST_REPLY_RECEIVED";
      const annotationUnavailable = annotationNotification && (!item.annotationCurrent || (
        item.notification.notificationType === "POST_ANNOTATION_RECEIVED"
          ? !item.annotationAvailable
          : !item.annotationReplyAvailable
      ));
      return <Link className={`notification-item${isUnread ? " notification-item--unread" : ""}`} href={`/notifications/${item.notification.id}`} key={item.notification.id}>
        <Avatar name={item.actor.displayName} assetId={item.actor.avatarAssetId} />
        <div className="notification-content">
          <p>
            {isDocxAttribution
              ? item.docxAttribution
                ? formatDocxAttributionNotice(item.docxAttribution, { includePostTitle: item.postAvailable })
                : "收到了一条 DOCX 批注关联通知，但通知详情已不可用。"
              : <><strong>{item.actor.displayName}</strong>{" "}
            {!item.post || !item.postReachable
              ? "有一条关联内容已不可用"
              : item.notification.notificationType === "POST_ANNOTATION_RECEIVED"
                ? annotationUnavailable
                  ? `批注了你的帖子，但该批注已经${item.annotationState === "hidden" ? "被管理员隐藏" : "不可用"}`
                  : item.postAvailable ? <>批注了你的帖子《{item.post.title}》</> : <>批注了你的一条正文已撤下的讨论</>
              : item.notification.notificationType === "ANNOTATION_REPLY_RECEIVED"
                ? annotationUnavailable
                  ? `回复了你，但该批注回复已经${item.annotationReplyState === "hidden" ? "被管理员隐藏" : "不可用"}`
                  : item.postAvailable ? <>回复了你在《{item.post.title}》中的批注讨论</> : <>回复了你的一条正文已撤下的批注讨论</>
              : !item.replyAvailable || !item.reply
                ? `回复了你，但该回复已经被${item.replyState === "hidden" ? "管理员隐藏" : "删除"}`
                : item.event.replyToUserId
                  ? item.postAvailable ? <>回复了你在《{item.post.title}》中的回复</> : <>回复了你在一条正文已撤下的讨论中的回复</>
                  : item.postAvailable ? <>回复了你的帖子《{item.post.title}》</> : <>回复了你的一条正文已撤下的讨论</>}</>}
          </p>
          {item.notification.notificationType === "POST_REPLY_RECEIVED" && item.replyAvailable && item.reply && <blockquote>{truncateActivityPreview(markdownToPlainText(item.reply.markdown), 90)}</blockquote>}
          {item.notification.notificationType === "ANNOTATION_REPLY_RECEIVED" && item.annotationReplyAvailable && item.annotationReply && <blockquote>{truncateActivityPreview(markdownToPlainText(item.annotationReply.contentMarkdown), 90)}</blockquote>}
          <div className="notification-meta"><time>{formatDateTime(item.notification.createdAt)}</time><span>{isUnread ? "未读" : "已读"}</span></div>
        </div>
        {isUnread && <span className="unread-dot" aria-label="未读" />}
      </Link>;
    })}
  </section>;
}
