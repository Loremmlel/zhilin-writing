"use client";

import { useState, type ReactNode } from "react";

import type { AnnotationReplyActionState } from "@/app/(site)/posts/[id]/actions";
import { AnnotationReplyForm } from "@/components/annotations/annotation-reply-form";
import { Avatar } from "@/components/avatar";
import {
  DeleteContentControl,
  type LifecycleActionState,
} from "@/components/lifecycle/delete-content-control";
import { annotationSourceMetadata, type AnnotationAuthorView } from "@/lib/annotations/identity";
import { annotationThreadCapabilities } from "@/lib/annotations/layout";
import {
  annotationReplyComposerLabel,
  buildAnnotationDiscussionItems,
  initialAnnotationReplyComposerState,
  nextAnnotationReplyComposerState,
} from "@/lib/annotations/reply-composer";

export type AnnotationCardView = {
  id: string;
  originalSelectedText: string;
  contentHtml: string;
  createdAtLabel: string;
  author: AnnotationAuthorView;
  lifecycle: {
    state: "normal" | "deleted" | "hidden";
    contentVisible: boolean;
    placeholder: string | null;
  };
  permissions: { canDelete: boolean; canRemoveImportedThread: boolean };
  deleteDescription: string;
  replySubmissionKey: string;
  replies: Array<{
    id: string;
    contentHtml: string;
    createdAtLabel: string;
    replySubmissionKey: string;
    author: AnnotationAuthorView;
    replyTo: { id: string | null; displayName: string } | null;
    lifecycle: {
      state: "normal" | "deleted" | "hidden";
      contentVisible: boolean;
      placeholder: string | null;
    };
    permissions: { canDelete: boolean; canRemoveImportedThread: boolean };
    deleteDescription: string;
  }>;
};

export type AnnotationReplyAction = (
  annotationId: string,
  targetReplyId: string | null,
  state: AnnotationReplyActionState,
  formData: FormData,
) => Promise<AnnotationReplyActionState>;
export type AnnotationDeleteAction = (
  annotationId: string,
  state: LifecycleActionState,
  formData: FormData,
) => Promise<LifecycleActionState>;
export type AnnotationReplyDeleteAction = (
  replyId: string,
  state: LifecycleActionState,
  formData: FormData,
) => Promise<LifecycleActionState>;
export type AnnotationRemoveImportedAction = AnnotationDeleteAction;
type AnnotationReplyView = AnnotationCardView["replies"][number];

function AnnotationIdentity({
  author,
  createdAtLabel,
}: {
  author: AnnotationAuthorView;
  createdAtLabel: string;
}) {
  const sourceMetadata = annotationSourceMetadata(author);
  return (
    <div>
      <strong>{author.displayName}</strong>
      <span className="annotation-author-meta">
        {sourceMetadata && <>{sourceMetadata} · </>}
        <time>{createdAtLabel}</time>
      </span>
    </div>
  );
}

function AnnotationReplyIdentity({
  author,
  createdAtLabel,
  replyTo,
}: {
  author: AnnotationAuthorView;
  createdAtLabel: string;
  replyTo: { displayName: string } | null;
}) {
  const sourceMetadata = annotationSourceMetadata(author);
  return (
    <div>
      <strong>{author.displayName}</strong>
      <span>
        {sourceMetadata ? `${sourceMetadata} · ` : ""}
        {replyTo ? `回复 ${replyTo.displayName}` : "回复批注"} · {createdAtLabel}
      </span>
    </div>
  );
}

type AnnotationThreadProps = {
  annotation: AnnotationCardView;
  onLocate?: () => void;
  highlightReplyId?: string | null;
} & (
  | {
      readOnly: true;
      replyAction?: never;
      deleteAction?: never;
      deleteReplyAction?: never;
      removeImportedAction?: never;
      allowReplies?: never;
    }
  | {
      readOnly?: false;
      replyAction: AnnotationReplyAction;
      deleteAction: AnnotationDeleteAction;
      deleteReplyAction: AnnotationReplyDeleteAction;
      removeImportedAction: AnnotationRemoveImportedAction;
      allowReplies?: boolean;
    }
);

function AnnotationRoot({
  annotation,
  onLocate,
}: {
  annotation: AnnotationCardView;
  onLocate?: () => void;
}) {
  return (
    <>
      <header className="annotation-card-header">
        <Avatar
          name={annotation.author.displayName}
          assetId={annotation.author.avatarAssetId}
          size="small"
        />
        <AnnotationIdentity author={annotation.author} createdAtLabel={annotation.createdAtLabel} />
        {onLocate && (
          <button type="button" className="annotation-card-locate" onClick={onLocate}>
            定位正文
          </button>
        )}
      </header>
      {annotation.lifecycle.contentVisible ? (
        <div
          className="markdown-body markdown-body--annotation"
          dangerouslySetInnerHTML={{ __html: annotation.contentHtml }}
        />
      ) : (
        <p className="annotation-placeholder">{annotation.lifecycle.placeholder}</p>
      )}
    </>
  );
}

function AnnotationReplyContent({
  reply,
  children,
  highlighted = false,
}: {
  reply: AnnotationReplyView;
  children?: ReactNode;
  highlighted?: boolean;
}) {
  return (
    <section
      className={`annotation-reply${highlighted ? " is-deep-linked" : ""}`}
      id={`annotation-reply-${reply.id}`}
      tabIndex={-1}
    >
      <header>
        <Avatar name={reply.author.displayName} assetId={reply.author.avatarAssetId} size="small" />
        <AnnotationReplyIdentity
          author={reply.author}
          createdAtLabel={reply.createdAtLabel}
          replyTo={reply.replyTo}
        />
      </header>
      {reply.lifecycle.contentVisible ? (
        <div
          className="markdown-body markdown-body--annotation"
          dangerouslySetInnerHTML={{ __html: reply.contentHtml }}
        />
      ) : (
        <p className="annotation-placeholder">{reply.lifecycle.placeholder}</p>
      )}
      {children}
    </section>
  );
}

function AnnotationReplyList({
  replies,
  renderActions,
  highlightReplyId,
}: {
  replies: AnnotationReplyView[];
  renderActions?: (reply: AnnotationReplyView) => ReactNode;
  highlightReplyId?: string | null;
}) {
  if (replies.length === 0) return <p className="annotation-reply-empty">还没有回复。</p>;
  return (
    <>
      <div className="annotation-reply-heading">
        <span>已有回复</span>
        <strong>{replies.length}</strong>
      </div>
      <div className="annotation-reply-list">
        {replies.map((reply) => (
          <AnnotationReplyContent
            reply={reply}
            highlighted={highlightReplyId === reply.id}
            key={reply.id}
          >
            {renderActions?.(reply)}
          </AnnotationReplyContent>
        ))}
      </div>
    </>
  );
}

function InteractiveAnnotationDiscussion({
  annotation,
  replyAction,
  deleteAction,
  deleteReplyAction,
  removeImportedAction,
  allowReplies,
  highlightReplyId,
}: {
  annotation: AnnotationCardView;
  replyAction: AnnotationReplyAction;
  deleteAction: AnnotationDeleteAction;
  deleteReplyAction: AnnotationReplyDeleteAction;
  removeImportedAction: AnnotationRemoveImportedAction;
  allowReplies: boolean;
  highlightReplyId?: string | null;
}) {
  const capabilities = annotationThreadCapabilities("interactive");
  const [composer, setComposer] = useState(initialAnnotationReplyComposerState);
  const [focusRequest, setFocusRequest] = useState(0);
  const canReply = capabilities.reply && allowReplies && annotation.lifecycle.state !== "hidden";
  const openComposer = (
    event: { type: "root" } | { type: "reply"; replyId: string; displayName: string },
  ) => {
    setComposer((current) => nextAnnotationReplyComposerState(current, event));
    setFocusRequest((current) => current + 1);
  };
  const items = buildAnnotationDiscussionItems(annotation.replies);
  const composerItem = items.find((item) => item.kind === "composer");
  const replyCountItem = items.find((item) => item.kind === "reply-count");
  const replyItems = items.filter((item) => item.kind === "reply");

  return (
    <>
      {composerItem && (
        <div className="annotation-shared-reply">
          {canReply && (
            <button
              type="button"
              className="annotation-reply-cta"
              onClick={() => openComposer({ type: "root" })}
            >
              回复批注
            </button>
          )}
          {canReply && composer.open && (
            <div className="annotation-shared-reply-panel">
              <div className="annotation-shared-reply-header">
                <strong>{annotationReplyComposerLabel(composer)}</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setComposer((current) =>
                      nextAnnotationReplyComposerState(current, { type: "close" }),
                    )
                  }
                >
                  收起
                </button>
              </div>
              {composer.target && (
                <button
                  type="button"
                  className="annotation-reply-root-target"
                  onClick={() => openComposer({ type: "root" })}
                >
                  改为回复批注
                </button>
              )}
              <AnnotationReplyForm
                action={replyAction.bind(null, annotation.id, composer.target?.replyId ?? null)}
                initialSubmissionKey={annotation.replySubmissionKey}
                label="发送回复"
                focusRequest={focusRequest}
                onSuccess={() =>
                  setComposer((current) =>
                    nextAnnotationReplyComposerState(current, { type: "success" }),
                  )
                }
              />
            </div>
          )}
          {capabilities.delete &&
            annotation.lifecycle.contentVisible &&
            annotation.permissions.canDelete && (
              <DeleteContentControl
                action={deleteAction.bind(null, annotation.id)}
                label="删除批注"
                title="删除这条批注？"
                description={annotation.deleteDescription}
              />
            )}
          {capabilities.remove &&
            annotation.lifecycle.contentVisible &&
            annotation.permissions.canRemoveImportedThread && (
              <DeleteContentControl
                action={removeImportedAction.bind(null, annotation.id)}
                label="移除导入批注"
                title="移除这条 Word 导入批注？"
                description={annotation.deleteDescription}
                confirmLabel="确认移除"
                pendingLabel="正在移除…"
              />
            )}
        </div>
      )}
      {replyCountItem?.kind === "reply-count" && replyCountItem.count > 0 && (
        <div className="annotation-reply-heading">
          <span>已有回复</span>
          <strong>{replyCountItem.count}</strong>
        </div>
      )}
      {replyCountItem?.kind === "reply-count" && replyCountItem.count === 0 && (
        <p className="annotation-reply-empty">还没有回复。</p>
      )}
      {replyItems.length > 0 && (
        <div className="annotation-reply-list">
          {replyItems.map((item) => {
            if (item.kind !== "reply") return null;
            const reply = item.reply;
            return (
              <AnnotationReplyContent
                reply={reply}
                highlighted={highlightReplyId === reply.id}
                key={reply.id}
              >
                {capabilities.delete &&
                  reply.lifecycle.contentVisible &&
                  reply.permissions.canDelete && (
                    <DeleteContentControl
                      action={deleteReplyAction.bind(null, reply.id)}
                      label="删除回复"
                      title="删除这条批注回复？"
                      description={reply.deleteDescription}
                    />
                  )}
                {canReply && reply.lifecycle.contentVisible && (
                  <button
                    type="button"
                    className="annotation-reply-action"
                    onClick={() =>
                      openComposer({
                        type: "reply",
                        replyId: reply.id,
                        displayName: reply.author.displayName,
                      })
                    }
                  >
                    回复
                  </button>
                )}
              </AnnotationReplyContent>
            );
          })}
        </div>
      )}
    </>
  );
}

export function AnnotationThread(props: AnnotationThreadProps) {
  const { annotation, onLocate, highlightReplyId } = props;
  return (
    <>
      <AnnotationRoot annotation={annotation} onLocate={onLocate} />
      {props.readOnly === true ? (
        <AnnotationReplyList replies={annotation.replies} highlightReplyId={highlightReplyId} />
      ) : (
        <InteractiveAnnotationDiscussion
          annotation={annotation}
          replyAction={props.replyAction}
          deleteAction={props.deleteAction}
          deleteReplyAction={props.deleteReplyAction}
          removeImportedAction={props.removeImportedAction}
          allowReplies={props.allowReplies ?? true}
          highlightReplyId={highlightReplyId}
        />
      )}
    </>
  );
}
