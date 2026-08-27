import Link from "next/link";

import type { listUserActivity } from "@/db/queries";
import { formatDateTime } from "@/lib/format";
import { annotationTargetHref, truncateActivityPreview } from "@/lib/activity/policy";
import { markdownToPlainText } from "@/lib/markdown/render";

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
    const href = item.annotationCurrent && item.annotation
      ? annotationTargetHref(item.post.id, item.annotation.id)
      : `/posts/${item.post.id}?notice=annotation-unavailable`;
    if (!item.annotationAvailable || !item.annotation) {
      return <p><strong>{item.actor.displayName}</strong> <Link href={href}>批注了一段现已不可用的文字</Link></p>;
    }
    return <>
      <p><strong>{item.actor.displayName}</strong> 批注了 <Link href={href}>《{item.post.title}》中的一段文字</Link></p>
      <blockquote>{truncateActivityPreview(item.annotation.originalSelectedText, 48)}</blockquote>
    </>;
  }
  if (item.event.eventType === "ANNOTATION_REPLY_CREATED") {
    const href = item.annotationCurrent && item.annotation
      ? annotationTargetHref(item.post.id, item.annotation.id)
      : `/posts/${item.post.id}?notice=annotation-unavailable`;
    if (!item.annotationReplyAvailable || !item.annotationReply) {
      return <p><strong>{item.actor.displayName}</strong> <Link href={href}>回复了一条现已不可用的批注讨论</Link></p>;
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
    return <p><strong>{item.actor.displayName}</strong> <Link href={`/posts/${item.post.id}#replies`}>回复了一条现已删除或隐藏的内容</Link></p>;
  }
  const target = <Link href={`/posts/${item.post.id}#reply-${item.reply.id}`}>{item.postAvailable ? `《${item.post.title}》` : "一条正文已撤下的讨论"}</Link>;
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
