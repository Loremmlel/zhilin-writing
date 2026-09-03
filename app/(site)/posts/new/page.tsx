import { PostEditorForm } from "@/components/editor/post-editor-form";
import { requireMember } from "@/lib/auth/access";
import Link from "next/link";
import { createPostAction } from "./actions";

export default async function NewPostPage() {
  const { member } = await requireMember("/posts/new");
  return (
    <div className="page-column editor-page">
      <header className="page-header">
        <span className="eyebrow">新帖子</span>
        <h1>写下一点什么</h1>
        <p>编辑器会在后台维护 Markdown。你可以从空白开始，也可以连同 Word 批注一起导入 DOCX。</p>
        <Link
          className="button button--ghost button--small new-post-import-link"
          href="/posts/import"
        >
          从 DOCX 导入
        </Link>
      </header>
      <PostEditorForm userId={member.id} draftId="new" action={createPostAction} />
    </div>
  );
}
