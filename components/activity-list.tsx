import Link from "next/link";

import type { listUserActivity } from "@/db/queries";
import { formatDateTime } from "@/lib/format";
import { annotationReplyTargetHref, annotationTargetHref, replyTargetHref, truncateActivityPreview } from "@/lib/activity/policy";
import { markdownToPlainText } from "@/lib/markdown/render";
import { notificationTargetNotice, resolveNotificationTarget, targetHrefWithNotice } from "@/lib/notifications/target-resolution";

type ActivityItem = Awaited<ReturnType<typeof listUserActivity>>[number];

function ActivityCopy({ item }: { item: ActivityItem }) {
  if (!item.post || !item.postReachable) {
    return <p><strong>{item.actor.displayName}</strong> 的一条公开内容现已不可用</p>;
  }
  if (item.event.eventType === "POST_CREATED") {
    return item.postAvailable
      ? <p><strong>{item.actor.displayName}</strong> 发布了 <Link href={`/posts/${item.post.id}`}>《{item.post.title}》</Link></p>
      : <p><strong>{item.actor.displayName}</strong> <Link href={`/posts/${item.post.id}`}>发布了一条现已不可用的内容</Link></p>;
  }
  if (item.event.eventType === "ANNOTATION_CREATED") {
    const baseHref = item.annotation ? annotationTargetHref(item.post.id, item.annotation.id) : `/posts/${item.post.id}?target=annotation`;
    const resolution = resolveNotificationTarget({ kind: "ANNOTATION", postExists: true, postReachable: item.postReachable, targetState: item.annotation ? item.annotationState : null, annotationCurrent: item.annotationCurrent });
    const href = resolution.state === "AVAILABLE" ? baseHref : targetHrefWithNotice(baseHref, resolution.state);
    if (!item.annotationAvailable || !item.annotation) {
      const notice = resolution.state === "AVAILABLE" ? "该批注当前不可用。" : notificationTargetNotice(resolution.state, resolution.kind);
      return <p><strong>{item.actor.displayName}</strong> <Link href={href}>批注了一段文字</Link>；{notice}</p>;
    }
    return <>
      <p><strong>{item.actor.displayName}</strong> 批注了 <Link href={href}>《{item.post.title}》中的一段文字</Link></p>
      <blockquote>{truncateActivityPreview(item.annotation.originalSelectedText, 48)}</blockquote>
    </>;
  }
  if (item.event.eventType === "ANNOTATION_REPLY_CREATED") {
    const baseHref = item.annotation && item.annotationReply
      ? annotationReplyTargetHref(item.post.id, item.annotation.id, item.annotationReply.id)
      : item.annotation ? annotationTargetHref(item.post.id, item.annotation.id) : `/posts/${item.post.id}?target=annotation-reply`;
    const resolution = resolveNotificationTarget({ kind: "ANNOTATION_REPLY", postExists: true, postReachable: item.postReachable, targetState: item.annotationReply ? item.annotationReplyState : null, annotationCurrent: item.annotationCurrent });
    const href = resolution.state === "AVAILABLE" ? baseHref : targetHrefWithNotice(baseHref, resolution.state);
    if (!item.annotationReplyAvailable || !item.annotationReply) {
      const notice = resolution.state === "AVAILABLE" ? "该回复当前不可用。" : notificationTargetNotice(resolution.state, resolution.kind);
      return <p><strong>{item.actor.displayName}</strong> <Link href={href}>回复了一条批注讨论</Link>；{notice}</p>;
    }
    return <>
      <p>
        <strong>{item.actor.displayName}</strong>{" "}
        {item.replyTo
          ? <>回复了 <strong>{item.replyTo.displayName}</strong> 在 <Link href={href}>《{item.post.title}》中的批注</Link></>
          : <>回复了 <Link href={href}>《{item.post.title}》中的批注</Link></>}
      </p>
      <blockquote>{truncateActivityPreview(markdownToPlainText(item.annotationReply.contentMarkdown))}</blockquote>
    </>;
  }
  if (!item.replyAvailable || !item.reply) {
    const baseHref = item.reply ? replyTargetHref(item.post.id, item.reply.id) : `/posts/${item.post.id}?target=post-reply`;
    const resolution = resolveNotificationTarget({ kind: "POST_REPLY", postExists: true, postReachable: item.postReachable, targetState: item.reply ? item.replyState : null });
    const href = resolution.state === "AVAILABLE" ? baseHref : targetHrefWithNotice(baseHref, resolution.state);
    const notice = resolution.state === "AVAILABLE" ? "该回复当前不可用。" : notificationTargetNotice(resolution.state, resolution.kind);
    return <p><strong>{item.actor.displayName}</strong> <Link href={href}>发布了一条回复</Link>；{notice}</p>;
  }
  const target = <Link href={replyTargetHref(item.post.id, item.reply.id)}>{item.postAvailable ? `《${item.post.title}》` : "一条正文已撤下的讨论"}</Link>;
  return <>
    <p>
      <strong>{item.actor.displayName}</strong>{" "}
      {item.replyTo
        ? <>回复了 <strong>{item.replyTo.displayName}</strong> 在 {target} 中的回复</>
        : <>回复了 {target}</>}
    </p>
    <blockquote>{truncateActivityPreview(markdownToPlainText(item.reply.markdown))}</blockquote>
  </>;
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <div className="empty-state"><h2>还没有公开动态</h2><p>发布帖子、回复或批注后，活动会按时间显示在这里。</p></div>;
  return <section className="activity-list" aria-label="用户动态">
    {items.map((item) => <article className="activity-item" key={item.event.id}>
      <span className="activity-dot" aria-hidden="true" />
      <div className="activity-content">
        <ActivityCopy item={item} />
        <time>{formatDateTime(item.event.createdAt)}</time>
      </div>
    </article>)}
  </section>;
}
