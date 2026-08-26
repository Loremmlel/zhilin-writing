import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { DeleteContentControl } from "@/components/lifecycle/delete-content-control";
import { ReplyForm } from "@/components/reply-form";
import { ReplyList } from "@/components/reply-list";
import { getPostDetail, listReplies } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";
import { formatDateTime } from "@/lib/format";
import { deletePostConfirmation } from "@/lib/lifecycle/policy";
import { renderMarkdown } from "@/lib/markdown/render";
import { createReplyAction, deletePostAction, deleteReplyAction } from "./actions";

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [{ member }, item, rawReplies] = await Promise.all([requireMember(`/posts/${id}`), getPostDetail(id), listReplies(id)]);
  if (!item) notFound();
  const [postHtml, replyViews] = await Promise.all([
    item.markdown ? renderMarkdown(item.markdown) : Promise.resolve(""),
    Promise.all(rawReplies.map(async (reply) => ({
      ...reply,
      html: reply.lifecycle.contentVisible ? await renderMarkdown(reply.reply.markdown) : "",
    }))),
  ]);
  const topReplyAction = createReplyAction.bind(null, id, null);
  const visibleReplyCount = replyViews.filter((reply) => reply.lifecycle.contentVisible).length;
  const discussionVisible = item.lifecycle.contentVisible || item.lifecycle.discussionReachable;
  return (
    <div className="reading-page page-column">
      {item.lifecycle.contentVisible ? <article className="post-article">
          <header className="post-header">
            <div className="post-kicker">{item.tags.map((tag) => <Link className="tag" key={tag.id} href={`/tags/${encodeURIComponent(tag.normalizedName)}`}>{tag.name}</Link>)}</div>
            <h1>{item.title}</h1>
            <div className="post-byline">
              <Link href={`/users/${item.author.id}`} className="author-link"><Avatar name={item.author.displayName} assetId={item.author.avatarAssetId} /><span>{item.author.displayName}</span></Link>
              <span>发布于 {formatDateTime(item.post.publishedAt)}</span>
              {item.post.editedAt && <span>编辑于 {formatDateTime(item.post.editedAt)}</span>}
              {item.post.authorId === member.id && <Link href={`/posts/${id}/edit`} className="text-link">编辑帖子</Link>}
              {item.post.authorId === member.id && <DeleteContentControl
                action={deletePostAction.bind(null, id)}
                label="删除帖子"
                title="删除这篇帖子？"
                description={deletePostConfirmation(item.lifecycle.hasOtherMemberDiscussion)}
              />}
            </div>
          </header>
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: postHtml }} />
          {item.attachments.length > 0 && <section className="attachment-area">
            <h2>附件</h2>
            {item.attachments.map((asset) => <a href={`/api/assets/${asset.id}`} key={asset.id} className="attachment-link"><span>{asset.filename}</span><small>{Math.ceil(asset.byteSize / 1024)} KB</small></a>)}
          </section>}
        </article>
        : <article className="post-article post-article--unavailable">
          <span className="eyebrow">内容状态</span>
          <h1>{item.lifecycle.state === "hidden" ? "已隐藏帖子" : "已删除帖子"}</h1>
          <p className="deleted-placeholder">{item.lifecycle.placeholder}</p>
          {item.lifecycle.discussionReachable
            ? <p className="muted">帖子正文和附件已撤下，其他成员已经发布的讨论仍保留在下方。</p>
            : <p className="muted">正文、标题和附件不再公开显示。</p>}
        </article>}
      {discussionVisible && <section className="replies-section" id="replies">
        {query.notice === "reply-deleted" && <div className="content-notice" role="status">该回复已经被删除。</div>}
        {query.notice === "reply-hidden" && <div className="content-notice" role="status">该回复已被管理员隐藏。</div>}
        <div className="section-heading"><h2>回复</h2><span>{visibleReplyCount} 条</span></div>
        {replyViews.length > 0 ? <ReplyList items={replyViews} currentUserId={member.id} replyActionFor={(targetId) => createReplyAction.bind(null, id, targetId)} deleteActionFor={(replyId) => deleteReplyAction.bind(null, id, replyId)} /> : <p className="empty-copy">还没有回复。可以从一句认真读过的话开始。</p>}
        {item.lifecycle.contentVisible && <div className="new-reply-block"><h3>写一条回复</h3><ReplyForm action={topReplyAction} initialSubmissionKey={crypto.randomUUID()} /></div>}
      </section>}
    </div>
  );
}
