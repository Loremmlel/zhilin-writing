import { PostEditorForm } from "@/components/editor/post-editor-form";
import { requireMember } from "@/lib/auth/access";
import { createPostAction } from "./actions";

export const metadata = { title: "写帖子" };

export default async function NewPostPage() {
  const { member } = await requireMember("/posts/new");
  return (
    <div className="page-column editor-page">
      <PostEditorForm userId={member.id} draftId="new" action={createPostAction} />
    </div>
  );
}
