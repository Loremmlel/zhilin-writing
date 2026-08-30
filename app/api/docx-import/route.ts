import { requireMember } from "@/lib/auth/access";
import {
  commitDocxImport,
  DocxImportCommitError,
} from "@/lib/docx-import/commit-service";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  MEMBER_REQUIRED: "当前账号没有导入权限。",
  IMPORT_BATCH_CONFLICT: "这份导入预览与已提交的内容不一致，请重新选择 DOCX。",
  ATTRIBUTED_USER_INVALID: "批注作者关联已失效，请重新选择。",
  ASSET_NOT_CLAIMABLE: "预览图片已失效，请重新导入 DOCX。",
  IMPORT_COMMIT_FAILED: "未能完成导入，请稍后重试。",
  DATABASE_UNAVAILABLE: "站点暂时无法保存导入内容，请稍后重试。",
};

export async function POST(request: Request) {
  const { member } = await requireMember("/posts/import");
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: { code: "COMMIT_SCHEMA_INVALID", message: "导入请求格式无效。" } }, { status: 400 });
  }

  try {
    const result = await commitDocxImport(member.id, input);
    return Response.json({ result }, { status: result.alreadyCommitted ? 200 : 201 });
  } catch (error) {
    if (error instanceof DocxImportCommitError) {
      return Response.json({
        error: {
          code: error.code,
          message: errorMessages[error.code] ?? (error.status >= 500 ? "未能完成导入，请稍后重试。" : "导入内容未通过校验。"),
        },
      }, { status: error.status });
    }
    return Response.json({ error: { code: "IMPORT_COMMIT_FAILED", message: "未能完成导入，请稍后重试。" } }, { status: 500 });
  }
}
