import { listPostVisibilityUsers } from "@/lib/posts/visibility-service";
import { PostEditorForm } from "@/components/editor/post-editor-form";
import { requireMember } from "@/lib/auth/access";
import { createPostAction } from "./actions";

export const metadata = { title: "写帖子" };

export default async function NewPostPage() {
  const { member } = await requireMember("/posts/new");
  const visibilityUsers = await listPostVisibilityUsers();
  return (
    <div className="page-column editor-page">
      <PostEditorForm
        visibilityUsers={visibilityUsers}
        userId={member.id}
        draftId="new"
        action={createPostAction}
      />
    </div>
  );
}
