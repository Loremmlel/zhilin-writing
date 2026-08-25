import { Avatar } from "@/components/avatar";
import type { ReplyRecord, SiteUser } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { ReplyForm, type ReplyFormAction } from "@/components/reply-form";

export type ReplyView = {
  reply: ReplyRecord;
  author: SiteUser;
  replyTo: SiteUser | null;
  html: string;
};

type ReplyListProps = {
  items: ReplyView[];
  currentUserId: string;
  replyActionFor: (targetId: string) => ReplyFormAction;
  deleteActionFor: (replyId: string) => (formData: FormData) => Promise<void>;
};

function ReplyItem({ item, nested, currentUserId, replyActionFor, deleteActionFor }: {
  item: ReplyView; nested: boolean; currentUserId: string;
  replyActionFor: ReplyListProps["replyActionFor"];
  deleteActionFor: ReplyListProps["deleteActionFor"];
}) {
  return (
    <article className={nested ? "reply reply--nested" : "reply"} id={`reply-${item.reply.id}`}>
      <div className="reply-author"><Avatar name={item.author.displayName} assetId={item.author.avatarAssetId} size="small" /></div>
      <div className="reply-body">
        <div className="reply-meta">
          <strong>{item.author.displayName}</strong>
          {item.replyTo && <span>回复 {item.replyTo.displayName}</span>}
          <time>{formatDateTime(item.reply.publishedAt)}</time>
        </div>
        <div className="markdown-body markdown-body--reply" dangerouslySetInnerHTML={{ __html: item.html }} />
        <details className="inline-reply">
          <summary>回复</summary>
          <ReplyForm action={replyActionFor(item.reply.id)} label={`回复 ${item.author.displayName}`} compact />
        </details>
        {item.reply.authorId === currentUserId && <form action={deleteActionFor(item.reply.id)} className="delete-reply-form">
          <button className="text-button text-button--danger" type="submit">删除这条回复</button>
        </form>}
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
