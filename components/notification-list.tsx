import Link from "next/link";

import { Avatar } from "@/components/avatar";
import type { listNotifications } from "@/db/queries";
import { truncateActivityPreview } from "@/lib/activity/policy";
import { formatDateTime } from "@/lib/format";
import { markdownToPlainText } from "@/lib/markdown/render";

type NotificationItem = Awaited<ReturnType<typeof listNotifications>>[number];

export function NotificationList({ items }: { items: NotificationItem[] }) {
  if (items.length === 0) return <div className="empty-state"><h2>这里很安静</h2><p>别人回复你的帖子或回复后，会在这里通知你。</p></div>;
  return <section className="notification-list" aria-label="通知列表">
    {items.map((item) => {
      const isUnread = !item.notification.readAt;
      return <Link className={`notification-item${isUnread ? " notification-item--unread" : ""}`} href={`/notifications/${item.notification.id}`} key={item.notification.id}>
        <Avatar name={item.actor.displayName} assetId={item.actor.avatarAssetId} />
        <div className="notification-content">
          <p>
            <strong>{item.actor.displayName}</strong>{" "}
            {!item.postAvailable || !item.post
              ? "有一条关联内容已不可用"
              : !item.replyAvailable || !item.reply
                ? "回复了你，但该回复已经被删除"
                : item.event.replyToUserId
                  ? <>回复了你在《{item.post.title}》中的回复</>
                  : <>回复了你的帖子《{item.post.title}》</>}
          </p>
          {item.replyAvailable && item.reply && <blockquote>{truncateActivityPreview(markdownToPlainText(item.reply.markdown), 90)}</blockquote>}
          <div className="notification-meta"><time>{formatDateTime(item.notification.createdAt)}</time><span>{isUnread ? "未读" : "已读"}</span></div>
        </div>
        {isUnread && <span className="unread-dot" aria-label="未读" />}
      </Link>;
    })}
  </section>;
}
