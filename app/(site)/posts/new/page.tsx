import { PostEditorForm } from "@/components/editor/post-editor-form";
import { requireMember } from "@/lib/auth/access";
import { createPostAction } from "./actions";

export default async function NewPostPage() {
  const { member } = await requireMember("/posts/new");
  return (
    <div className="page-column editor-page">
      <header className="page-header">
        <span className="eyebrow">新帖子</span>
        <h1>写下一点什么</h1>
        <p>编辑器会在后台维护 Markdown。你只需要像使用普通文档一样写作。</p>
      </header>
      <PostEditorForm userId={member.id} draftId="new" action={createPostAction} />
    </div>
  );
}
