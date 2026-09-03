import { Avatar } from "@/components/avatar";
import { DeleteContentControl, type LifecycleFormAction } from "@/components/lifecycle/delete-content-control";
import type { ReplyRecord, SiteUser } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { deleteReplyConfirmation } from "@/lib/lifecycle/policy";
import { ReplyForm, type ReplyFormAction } from "@/components/reply-form";

export type ReplyView = {
  reply: ReplyRecord;
  author: SiteUser;
  replyTo: SiteUser | null;
  replyToUnavailable: boolean;
  lifecycle: {
    state: "normal" | "deleted" | "hidden";
    contentVisible: boolean;
    placeholder: string | null;
    visibleDependentCount: number;
    visibleOtherAuthorDependentCount: number;
  };
  html: string;
};

type ReplyListProps = {
  items: ReplyView[];
  currentUserId: string;
  replyActionFor: (targetId: string) => ReplyFormAction;
  deleteActionFor: (replyId: string) => LifecycleFormAction;
};

function ReplyItem({ item, nested, currentUserId, replyActionFor, deleteActionFor }: {
  item: ReplyView; nested: boolean; currentUserId: string;
  replyActionFor: ReplyListProps["replyActionFor"];
  deleteActionFor: ReplyListProps["deleteActionFor"];
}) {
  return (
    <article className={nested ? "reply reply--nested" : "reply"} id={`reply-${item.reply.id}`} tabIndex={-1}>
      <div className="reply-author"><Avatar name={item.author.displayName} assetId={item.author.avatarAssetId} size="small" /></div>
      <div className="reply-body">
        <div className="reply-meta">
          <strong>{item.author.displayName}</strong>
          {item.replyTo && <span>{item.replyToUnavailable ? "回复了一条已删除或隐藏的回复" : `回复 ${item.replyTo.displayName}`}</span>}
          <time>{formatDateTime(item.reply.publishedAt)}</time>
        </div>
        {item.lifecycle.contentVisible
          ? <div className="markdown-body markdown-body--reply" dangerouslySetInnerHTML={{ __html: item.html }} />
          : <p className="deleted-placeholder">{item.lifecycle.placeholder}</p>}
        {item.lifecycle.contentVisible && <details className="inline-reply">
          <summary>回复</summary>
          <ReplyForm action={replyActionFor(item.reply.id)} initialSubmissionKey={crypto.randomUUID()} label={`回复 ${item.author.displayName}`} compact />
        </details>}
        {item.lifecycle.contentVisible && item.reply.authorId === currentUserId && <div className="delete-reply-form">
          <DeleteContentControl
            action={deleteActionFor(item.reply.id)}
            label="删除这条回复"
            title="删除这条回复？"
            description={deleteReplyConfirmation(item.lifecycle.visibleOtherAuthorDependentCount > 0)}
          />
        </div>}
      </div>
    </article>
  );
}

export function ReplyList({ items, currentUserId, replyActionFor, deleteActionFor }: ReplyListProps) {
  const roots = items.filter((item) => !item.reply.rootReplyId);
  const nested = new Map<string, ReplyView[]>();
  items.filter((item) => item.reply.rootReplyId).forEach((item) => {
    const list = nested.get(item.reply.rootReplyId!) ?? [];
    list.push(item);
    nested.set(item.reply.rootReplyId!, list);
  });
  return <div className="reply-list">
    {roots.map((root) => <div className="reply-thread" key={root.reply.id}>
      <ReplyItem item={root} nested={false} currentUserId={currentUserId} replyActionFor={replyActionFor} deleteActionFor={deleteActionFor} />
      {(nested.get(root.reply.id) ?? []).map((child) => <ReplyItem key={child.reply.id} item={child} nested currentUserId={currentUserId} replyActionFor={replyActionFor} deleteActionFor={deleteActionFor} />)}
    </div>)}
  </div>;
}
