import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { AnnotationReadingLayout, type AnnotationCardView } from "@/components/annotations/annotation-reading-layout";
import { AnnotationThread } from "@/components/annotations/annotation-thread";
import { DeleteContentControl } from "@/components/lifecycle/delete-content-control";
import { ReplyForm } from "@/components/reply-form";
import { ReplyList } from "@/components/reply-list";
import { getPostDetail, listReplies } from "@/db/queries";
import { listCurrentAnnotationThreads } from "@/lib/annotations/queries";
import { requireMember } from "@/lib/auth/access";
import { formatDateTime } from "@/lib/format";
import { deletePostConfirmation } from "@/lib/lifecycle/policy";
import { renderMarkdown } from "@/lib/markdown/render";
import { createAnnotationAction, createAnnotationReplyAction, createReplyAction, deleteAnnotationAction, deleteAnnotationReplyAction, deletePostAction, deleteReplyAction } from "./actions";

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; annotation?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [{ member }, item, rawReplies, rawAnnotations] = await Promise.all([requireMember(`/posts/${id}`), getPostDetail(id), listReplies(id), listCurrentAnnotationThreads(id)]);
  if (!item) notFound();
  const [postHtml, replyViews, annotationViews] = await Promise.all([
    item.markdown ? renderMarkdown(item.markdown, { annotationIds: rawAnnotations.map((row) => row.annotation.id) }) : Promise.resolve(""),
    Promise.all(rawReplies.map(async (reply) => ({
      ...reply,
      html: reply.lifecycle.contentVisible ? await renderMarkdown(reply.reply.markdown) : "",
    }))),
    Promise.all(rawAnnotations.map(async (row): Promise<AnnotationCardView> => ({
      id: row.annotation.id,
      originalSelectedText: row.annotation.originalSelectedText,
      contentHtml: row.lifecycle.contentVisible ? await renderMarkdown(row.annotation.contentMarkdown) : "",
      createdAtLabel: formatDateTime(row.annotation.createdAt),
      author: { id: row.author.id, displayName: row.author.displayName, avatarAssetId: row.author.avatarAssetId },
      lifecycle: row.lifecycle,
      deleteDescription: row.retainsAnchorOnAuthorDelete
        ? "删除后批注正文会变为占位，但其他成员的回复仍会保留。"
        : "删除后这条批注会从当前正文撤下；历史版本仍可由管理员恢复。",
      replySubmissionKey: crypto.randomUUID(),
      replies: await Promise.all(row.replies.map(async (reply) => ({
        id: reply.reply.id,
        contentHtml: reply.lifecycle.contentVisible ? await renderMarkdown(reply.reply.contentMarkdown) : "",
        createdAtLabel: formatDateTime(reply.reply.createdAt),
        replySubmissionKey: crypto.randomUUID(),
        author: { id: reply.author.id, displayName: reply.author.displayName, avatarAssetId: reply.author.avatarAssetId },
        replyTo: reply.replyTo ? { id: reply.replyTo.id, displayName: reply.replyTo.displayName } : null,
        lifecycle: { state: reply.lifecycle.state, contentVisible: reply.lifecycle.contentVisible, placeholder: reply.lifecycle.placeholder },
        deleteDescription: reply.lifecycle.visibleDependentCount > 0 ? "删除后内容会变为占位，明确回复它的其他内容仍会保留。" : "删除后这条回复会从普通页面撤下。",
      }))),
    }))),
  ]);
  const topReplyAction = createReplyAction.bind(null, id, null);
  const visibleReplyCount = replyViews.filter((reply) => reply.lifecycle.contentVisible).length;
  const discussionVisible = item.lifecycle.contentVisible || item.lifecycle.discussionReachable;
  return (
    <div className={`reading-page page-column${annotationViews.length ? " reading-page--annotated" : ""}`}>
      {item.lifecycle.contentVisible ? <article className={`post-article${annotationViews.length ? " post-article--annotated" : ""}`}>
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
          {item.post.currentRevisionId ? <AnnotationReadingLayout
            html={postHtml}
            annotations={annotationViews}
            baseRevisionId={item.post.currentRevisionId}
            action={createAnnotationAction.bind(null, id)}
            replyAction={createAnnotationReplyAction.bind(null, id)}
            deleteAction={deleteAnnotationAction.bind(null, id)}
            deleteReplyAction={deleteAnnotationReplyAction.bind(null, id)}
            currentUserId={member.id}
            initialAnnotationId={query.annotation}
          /> : <div className="markdown-body" dangerouslySetInnerHTML={{ __html: postHtml }} />}
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
      {!item.lifecycle.contentVisible && item.lifecycle.discussionReachable && annotationViews.length > 0 && <section className="annotation-detached-discussions" aria-label="保留的正文批注讨论">
        <div className="section-heading"><h2>正文批注讨论</h2><span>{annotationViews.length} 条</span></div>
        <p className="muted">正文已经撤下；其他成员发布的批注与回复仍保留。</p>
        <div className="annotation-detached-list">{annotationViews.map((annotation) => <article id={`annotation-card-${annotation.id}`} key={annotation.id} className={`annotation-card annotation-card--flow${query.annotation === annotation.id ? " is-active" : ""}`}>
          <AnnotationThread annotation={annotation} currentUserId={member.id} replyAction={createAnnotationReplyAction.bind(null, id)} deleteAction={deleteAnnotationAction.bind(null, id)} deleteReplyAction={deleteAnnotationReplyAction.bind(null, id)} allowReplies={false} />
        </article>)}</div>
      </section>}
      {discussionVisible && <section className="replies-section" id="replies">
        {query.notice === "reply-deleted" && <div className="content-notice" role="status">该回复已经被删除。</div>}
        {query.notice === "reply-hidden" && <div className="content-notice" role="status">该回复已被管理员隐藏。</div>}
        {query.notice === "annotation-unavailable" && <div className="content-notice" role="status">该批注已不可用，或不再属于当前正文。</div>}
        <div className="section-heading"><h2>回复</h2><span>{visibleReplyCount} 条</span></div>
        {replyViews.length > 0 ? <ReplyList items={replyViews} currentUserId={member.id} replyActionFor={(targetId) => createReplyAction.bind(null, id, targetId)} deleteActionFor={(replyId) => deleteReplyAction.bind(null, id, replyId)} /> : <p className="empty-copy">还没有回复。可以从一句认真读过的话开始。</p>}
        {item.lifecycle.contentVisible && <div className="new-reply-block"><h3>写一条回复</h3><ReplyForm action={topReplyAction} initialSubmissionKey={crypto.randomUUID()} /></div>}
      </section>}
    </div>
  );
}
