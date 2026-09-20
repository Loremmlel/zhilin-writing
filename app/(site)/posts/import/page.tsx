import type { Metadata } from "next";

import { DocxImportWorkspace } from "@/components/docx-import/docx-import-workspace";
import { listPostVisibilityUsers } from "@/lib/posts/visibility-service";
import { listUsers } from "@/db/queries";
import { requireWritingMember } from "@/lib/auth/access";

export const metadata: Metadata = { title: "导入 DOCX" };

export default async function ImportPostPage() {
  const { member } = await requireWritingMember("/posts/import");
  const [users, visibilityUsers] = await Promise.all([listUsers(), listPostVisibilityUsers()]);
  return (
    <div className="page-column docx-import-page">
      <header className="page-header docx-initial-header">
        <h1>导入 DOCX</h1>
      </header>
      <DocxImportWorkspace
        authorId={member.id}
        visibilityUsers={visibilityUsers}
        users={users.map(({ id, displayName }) => ({ id, displayName }))}
      />
    </div>
  );
}
