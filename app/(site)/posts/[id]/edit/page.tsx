import { notFound, redirect } from "next/navigation";

import { PostEditorForm } from "@/components/editor/post-editor-form";
import { getPost } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";
import { updatePostAction } from "../actions";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ member }, item] = await Promise.all([requireMember(`/posts/${id}/edit`), getPost(id)]);
  if (!item) notFound();
  if (item.post.authorId !== member.id) redirect(`/posts/${id}`);
  return (
    <div className="page-column editor-page">
      <header className="page-header"><span className="eyebrow">编辑帖子</span><h1>{item.post.title}</h1><p>保存后会显示编辑时间，但不会把帖子顶到“活跃”首位。</p></header>
      <PostEditorForm
        userId={member.id}
        draftId={id}
        action={updatePostAction.bind(null, id)}
        initial={{ title: item.post.title, markdown: item.post.markdown, tags: item.tags.map((tag) => tag.name), assetIds: item.attachments.map((asset) => asset.id) }}
        submitLabel="保存修改"
        cancelHref={`/posts/${id}`}
      />
    </div>
  );
}
