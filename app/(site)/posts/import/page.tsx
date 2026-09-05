import type { Metadata } from "next";

import { DocxImportWorkspace } from "@/components/docx-import/docx-import-workspace";
import { listUsers } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";

export const metadata: Metadata = { title: "导入 DOCX" };

export default async function ImportPostPage() {
  await requireMember("/posts/import");
  const users = await listUsers();
  return (
    <div className="page-column docx-import-page">
      <header className="page-header docx-initial-header">
        <h1>导入 DOCX</h1>
      </header>
      <DocxImportWorkspace users={users.map(({ id, displayName }) => ({ id, displayName }))} />
    </div>
  );
}
