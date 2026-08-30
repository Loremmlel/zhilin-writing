"use client";

import type { AnnotationReplyActionState } from "@/app/(site)/posts/[id]/actions";
import { AnnotationReplyForm } from "@/components/annotations/annotation-reply-form";
import { Avatar } from "@/components/avatar";
import { DeleteContentControl, type LifecycleActionState } from "@/components/lifecycle/delete-content-control";
import { annotationSourceMetadata, type AnnotationAuthorView } from "@/lib/annotations/identity";

export type AnnotationCardView = {
  id: string; originalSelectedText: string; contentHtml: string; createdAtLabel: string;
  author: AnnotationAuthorView;
  lifecycle: { state: "normal" | "deleted" | "hidden"; contentVisible: boolean; placeholder: string | null };
  permissions: { canDelete: boolean; canRemoveImportedThread: boolean };
  deleteDescription: string; replySubmissionKey: string;
  replies: Array<{
    id: string; contentHtml: string; createdAtLabel: string; replySubmissionKey: string;
    author: AnnotationAuthorView;
    replyTo: { id: string | null; displayName: string } | null;
    lifecycle: { state: "normal" | "deleted" | "hidden"; contentVisible: boolean; placeholder: string | null };
    permissions: { canDelete: boolean; canRemoveImportedThread: boolean };
    deleteDescription: string;
  }>;
};

export type AnnotationReplyAction = (annotationId: string, targetReplyId: string | null, state: AnnotationReplyActionState, formData: FormData) => Promise<AnnotationReplyActionState>;
export type AnnotationDeleteAction = (annotationId: string, state: LifecycleActionState, formData: FormData) => Promise<LifecycleActionState>;
export type AnnotationReplyDeleteAction = (replyId: string, state: LifecycleActionState, formData: FormData) => Promise<LifecycleActionState>;
export type AnnotationRemoveImportedAction = AnnotationDeleteAction;

function AnnotationIdentity({ author, createdAtLabel }: { author: AnnotationAuthorView; createdAtLabel: string }) {
  const sourceMetadata = annotationSourceMetadata(author);
  return <div>
    <strong>{author.displayName}</strong>
    <span className="annotation-author-meta">
      {sourceMetadata && <>{sourceMetadata} · </>}
      <time>{createdAtLabel}</time>
    </span>
  </div>;
}

function AnnotationReplyIdentity({ author, createdAtLabel, replyTo }: {
  author: AnnotationAuthorView; createdAtLabel: string; replyTo: { displayName: string } | null;
}) {
  const sourceMetadata = annotationSourceMetadata(author);
  return <div><strong>{author.displayName}</strong><span>{sourceMetadata ? `${sourceMetadata} · ` : ""}{replyTo ? `回复 ${replyTo.displayName}` : "回复批注"} · {createdAtLabel}</span></div>;
}

export function AnnotationThread({ annotation, replyAction, deleteAction, deleteReplyAction, removeImportedAction, onLocate, allowReplies = true }: {
  annotation: AnnotationCardView; replyAction: AnnotationReplyAction; deleteAction: AnnotationDeleteAction; deleteReplyAction: AnnotationReplyDeleteAction; removeImportedAction: AnnotationRemoveImportedAction; onLocate?: () => void; allowReplies?: boolean;
}) {
  return <>
    <header className="annotation-card-header">
      <Avatar name={annotation.author.displayName} assetId={annotation.author.avatarAssetId} size="small" />
      <AnnotationIdentity author={annotation.author} createdAtLabel={annotation.createdAtLabel} />
      {onLocate && <button type="button" className="annotation-card-locate" onClick={onLocate}>定位正文</button>}
    </header>
    <blockquote className="annotation-card-excerpt">{annotation.originalSelectedText}</blockquote>
    {annotation.lifecycle.contentVisible ? <div className="markdown-body markdown-body--annotation" dangerouslySetInnerHTML={{ __html: annotation.contentHtml }} /> : <p className="annotation-placeholder">{annotation.lifecycle.placeholder}</p>}
    {annotation.lifecycle.contentVisible && annotation.permissions.canDelete && <DeleteContentControl action={deleteAction.bind(null, annotation.id)} label="删除批注" title="删除这条批注？" description={annotation.deleteDescription} />}
    {annotation.lifecycle.contentVisible && annotation.permissions.canRemoveImportedThread && <DeleteContentControl action={removeImportedAction.bind(null, annotation.id)} label="移除导入批注" title="移除这条 Word 导入批注？" description={annotation.deleteDescription} confirmLabel="确认移除" pendingLabel="正在移除…" />}
    {annotation.replies.length > 0 && <div className="annotation-reply-list">{annotation.replies.map((reply) => <section className="annotation-reply" key={reply.id}>
      <header><Avatar name={reply.author.displayName} assetId={reply.author.avatarAssetId} size="small" /><AnnotationReplyIdentity author={reply.author} createdAtLabel={reply.createdAtLabel} replyTo={reply.replyTo} /></header>
      {reply.lifecycle.contentVisible ? <div className="markdown-body markdown-body--annotation" dangerouslySetInnerHTML={{ __html: reply.contentHtml }} /> : <p className="annotation-placeholder">{reply.lifecycle.placeholder}</p>}
      {reply.lifecycle.contentVisible && reply.permissions.canDelete && <DeleteContentControl action={deleteReplyAction.bind(null, reply.id)} label="删除回复" title="删除这条批注回复？" description={reply.deleteDescription} />}
      {allowReplies && reply.lifecycle.contentVisible && annotation.lifecycle.state !== "hidden" && <details className="annotation-inline-reply"><summary>回复 {reply.author.displayName}</summary><AnnotationReplyForm action={replyAction.bind(null, annotation.id, reply.id)} initialSubmissionKey={reply.replySubmissionKey} label="发布回复" /></details>}
    </section>)}</div>}
    {allowReplies && annotation.lifecycle.state !== "hidden" && <details className="annotation-inline-reply annotation-inline-reply--root"><summary>回复这条批注</summary><AnnotationReplyForm action={replyAction.bind(null, annotation.id, null)} initialSubmissionKey={annotation.replySubmissionKey} /></details>}
  </>;
}
