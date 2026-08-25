import Link from "next/link";

import type { listUserActivity } from "@/db/queries";
import { formatDateTime } from "@/lib/format";
import { truncateActivityPreview } from "@/lib/activity/policy";
import { markdownToPlainText } from "@/lib/markdown/render";

type ActivityItem = Awaited<ReturnType<typeof listUserActivity>>[number];

function ActivityCopy({ item }: { item: ActivityItem }) {
  if (!item.postAvailable || !item.post) {
    return <p><strong>{item.actor.displayName}</strong> 的一条公开内容现已不可用</p>;
  }
  if (item.event.eventType === "POST_CREATED") {
    return <p><strong>{item.actor.displayName}</strong> 发布了 <Link href={`/posts/${item.post.id}`}>《{item.post.title}》</Link></p>;
  }
  if (!item.replyAvailable || !item.reply) {
    return <p><strong>{item.actor.displayName}</strong> <Link href={`/posts/${item.post.id}#replies`}>回复了一条现已删除的内容</Link></p>;
  }
  return <>
    <p>
      <strong>{item.actor.displayName}</strong>{" "}
      {item.replyTo
        ? <>回复了 <strong>{item.replyTo.displayName}</strong> 在 <Link href={`/posts/${item.post.id}#reply-${item.reply.id}`}>《{item.post.title}》</Link> 中的回复</>
        : <>回复了 <Link href={`/posts/${item.post.id}#reply-${item.reply.id}`}>《{item.post.title}》</Link></>}
    </p>
    <blockquote>{truncateActivityPreview(markdownToPlainText(item.reply.markdown))}</blockquote>
  </>;
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <div className="empty-state"><h2>还没有公开动态</h2><p>发布帖子或回复后，活动会按时间显示在这里。</p></div>;
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
