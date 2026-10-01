import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { ProfileLink } from "@/components/profile-link";
import type { listNotificationsPage } from "@/db/queries";
import { truncateActivityPreview } from "@/lib/activity/policy";
import { formatDateTime, formatListDateTime } from "@/lib/format";
import { markdownToPlainText } from "@/lib/markdown/render";
import { formatDocxAttributionNotice } from "@/lib/notifications/policy";
import { notificationTargetNotice } from "@/lib/notifications/target-resolution";

type NotificationItem = Awaited<ReturnType<typeof listNotificationsPage>>["items"][number];

export function NotificationList({
  items,
  emptyKind = "all",
}: {
  items: NotificationItem[];
  emptyKind?: "all" | "unread";
}) {
  if (items.length === 0)
    return emptyKind === "unread" ? (
      <div className="empty-state">
        <p>没有未读通知。</p>
        <Link className="button button--ghost" href="/notifications">
          查看全部通知
        </Link>
      </div>
    ) : (
      <div className="empty-state">
        <p>暂时没有通知。</p>
        <Link className="button button--ghost" href="/">
          浏览帖子
        </Link>
      </div>
    );
  return (
    <section className="notification-list" aria-label="通知列表">
      {items.map((item) => {
        const isUnread = !item.notification.readAt;
        const isDocxAttribution = item.notification.notificationType === "DOCX_ATTRIBUTION_NOTICE";
        const targetResolution = item.targetResolution;
        const targetUnavailableCopy =
          targetResolution && targetResolution.state !== "AVAILABLE"
            ? notificationTargetNotice(targetResolution.state, targetResolution.kind)
            : null;
        return (
          <article
            className={`notification-item${isUnread ? " notification-item--unread" : ""}`}
            key={item.notification.id}
          >
            <ProfileLink userId={item.actor.id} name={item.actor.displayName} avatar>
              <Avatar name={item.actor.displayName} assetId={item.actor.avatarAssetId} />
            </ProfileLink>
            <div className="notification-content">
              <p>
                {isDocxAttribution ? (
                  item.docxAttribution ? (
                    <>
                      <strong>
                        <ProfileLink
                          userId={item.actor.id}
                          name={item.docxAttribution.importerDisplayName}
                        >
                          {item.docxAttribution.importerDisplayName}
                        </ProfileLink>
                      </strong>
                      {formatDocxAttributionNotice(item.docxAttribution, {
                        includePostTitle: item.postAvailable,
                        includeImporterName: false,
                      })}
                    </>
                  ) : (
                    "收到了一条 DOCX 批注关联通知，但通知详情已不可用。"
                  )
                ) : (
                  <>
                    <strong>
                      <ProfileLink userId={item.actor.id} name={item.actor.displayName}>
                        {item.actor.displayName}
                      </ProfileLink>
                    </strong>{" "}
                    {targetUnavailableCopy ? (
                      `${item.notification.notificationType === "POST_ANNOTATION_RECEIVED" ? "批注了你的帖子" : "回复了你"}；${targetUnavailableCopy}`
                    ) : !item.post || !item.postReachable ? (
                      "有一条关联内容已不可用"
                    ) : item.notification.notificationType === "POST_ANNOTATION_RECEIVED" ? (
                      item.postAvailable ? (
                        <>批注了你的帖子《{item.post.title}》</>
                      ) : (
                        <>批注了你的一条正文已撤下的讨论</>
                      )
                    ) : item.notification.notificationType === "ANNOTATION_REPLY_RECEIVED" ? (
                      item.postAvailable ? (
                        <>回复了你在《{item.post.title}》中的批注讨论</>
                      ) : (
                        <>回复了你的一条正文已撤下的批注讨论</>
                      )
                    ) : item.event.replyToUserId ? (
                      item.postAvailable ? (
                        <>回复了你在《{item.post.title}》中的回复</>
                      ) : (
                        <>回复了你在一条正文已撤下的讨论中的回复</>
                      )
                    ) : item.postAvailable ? (
                      <>回复了你的帖子《{item.post.title}》</>
                    ) : (
                      <>回复了你的一条正文已撤下的讨论</>
                    )}
                  </>
                )}
              </p>
              {item.notification.notificationType === "POST_REPLY_RECEIVED" &&
                item.replyAvailable &&
                item.reply && (
                  <blockquote>
                    {truncateActivityPreview(markdownToPlainText(item.reply.markdown), 90)}
                  </blockquote>
                )}
              {item.notification.notificationType === "ANNOTATION_REPLY_RECEIVED" &&
                item.annotationReplyAvailable &&
                item.annotationReply && (
                  <blockquote>
                    {truncateActivityPreview(
                      markdownToPlainText(item.annotationReply.contentMarkdown),
                      90,
                    )}
                  </blockquote>
                )}
              <div className="notification-meta">
                <Link
                  className="notification-detail-link"
                  href={`/notifications/${item.notification.id}`}
                  aria-label={`查看${item.actor.displayName}的这条通知`}
                >
                  <time
                    dateTime={item.notification.createdAt.toISOString()}
                    title={formatDateTime(item.notification.createdAt)}
                    aria-label={formatDateTime(item.notification.createdAt)}
                  >
                    {formatListDateTime(item.notification.createdAt)}
                  </time>
                </Link>
                <span>{isUnread ? "未读" : "已读"}</span>
              </div>
            </div>
            {isUnread && <span className="unread-dot" aria-label="未读" />}
          </article>
        );
      })}
    </section>
  );
}
