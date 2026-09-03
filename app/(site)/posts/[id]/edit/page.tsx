import { notFound, redirect } from "next/navigation";

import type { AnnotationCardView } from "@/components/annotations/annotation-thread";
import { PostEditorForm } from "@/components/editor/post-editor-form";
import { getPost } from "@/db/queries";
import { listCurrentAnnotationThreads } from "@/lib/annotations/queries";
import { requireMember } from "@/lib/auth/access";
import { assetMarkdown } from "@/lib/domain/rules";
import { formatDateTime } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown/render";
import { updatePostAction } from "../actions";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ member }, item, rawAnnotations] = await Promise.all([
    requireMember(`/posts/${id}/edit`),
    getPost(id),
    listCurrentAnnotationThreads(id),
  ]);
  if (!item) notFound();
  if (item.post.authorId !== member.id) redirect(`/posts/${id}`);
  const annotationViews = await Promise.all(
    rawAnnotations.map(async (row): Promise<AnnotationCardView> => ({
      id: row.annotation.id,
      originalSelectedText: row.annotation.originalSelectedText,
      contentHtml: row.lifecycle.contentVisible
        ? await renderMarkdown(row.annotation.contentMarkdown)
        : "",
      createdAtLabel: formatDateTime(row.annotation.sourceCreatedAt ?? row.annotation.createdAt),
      author: row.author,
      lifecycle: row.lifecycle,
      permissions: { canDelete: false, canRemoveImportedThread: false },
      deleteDescription: "",
      replySubmissionKey: "",
      replies: await Promise.all(
        row.replies.map(async (reply) => ({
          id: reply.reply.id,
          contentHtml: reply.lifecycle.contentVisible
            ? await renderMarkdown(reply.reply.contentMarkdown)
            : "",
          createdAtLabel: formatDateTime(reply.reply.sourceCreatedAt ?? reply.reply.createdAt),
          replySubmissionKey: "",
          author: reply.author,
          replyTo: reply.replyTo
            ? { id: reply.replyTo.id, displayName: reply.replyTo.displayName }
            : null,
          lifecycle: {
            state: reply.lifecycle.state,
            contentVisible: reply.lifecycle.contentVisible,
            placeholder: reply.lifecycle.placeholder,
          },
          permissions: { canDelete: false, canRemoveImportedThread: false },
          deleteDescription: "",
        })),
      ),
    })),
  );
  return (
    <div
      className={`page-column editor-page${annotationViews.length > 0 ? " editor-page--annotated" : ""}`}
    >
      <header className="page-header">
        <span className="eyebrow">编辑帖子</span>
        <h1>{item.post.title}</h1>
        <p>保存后会显示编辑时间，但不会把帖子顶到“活跃”首位。</p>
      </header>
      <PostEditorForm
        userId={member.id}
        draftId={id}
        action={updatePostAction.bind(null, id)}
        initial={{
          title: item.post.title,
          markdown: item.post.markdown,
          tags: item.tags.map((tag) => tag.name),
          baseRevisionId: item.post.currentRevisionId,
          attachments: item.attachments.map((asset) => ({
            id: asset.id,
            filename: asset.filename,
            kind: "attachment" as const,
            url: `/api/assets/${asset.id}`,
            markdown: assetMarkdown({
              kind: "attachment",
              filename: asset.filename,
              url: `/api/assets/${asset.id}`,
            }),
          })),
        }}
        submitLabel="保存修改"
        cancelHref={`/posts/${id}`}
        annotationThreads={annotationViews}
        annotationEditing={
          annotationViews.length > 0
            ? {
                baseAnnotationIds: annotationViews.map((annotation) => annotation.id),
                annotations: annotationViews.map((annotation) => ({
                  annotationId: annotation.id,
                  authorName: annotation.author.displayName,
                  replyCount: annotation.replies.length,
                })),
              }
            : undefined
        }
      />
    </div>
  );
}
