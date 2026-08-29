import type { Metadata } from "next";

import { DocxImportWorkspace } from "@/components/docx-import/docx-import-workspace";
import { listUsers } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";

export const metadata: Metadata = { title: "导入 DOCX | 知临中学" };

export default async function ImportPostPage() {
  await requireMember("/posts/import");
  const users = await listUsers();
  return (
    <div className="page-column docx-import-page">
      <header className="page-header">
        <span className="eyebrow">DOCX 导入</span>
        <h1>从 Word 带回一篇文章</h1>
        <p>原始文件只在当前浏览器中解析。确认预览前，正文、图片和批注都不会成为正式帖子。</p>
      </header>
      <DocxImportWorkspace users={users.map(({ id, displayName }) => ({ id, displayName }))} />
    </div>
  );
}
