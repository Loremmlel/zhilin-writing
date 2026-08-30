import { getApiMemberAccess } from "@/lib/auth/access";
import { DOCX_IMPORT_LIMITS } from "@/lib/docx-import/limits";
import {
  DocxImportBodyError,
  parseDocxImportCommitBody,
} from "@/lib/docx-import/commit-schema";
import {
  commitDocxImport,
  DocxImportCommitError,
} from "@/lib/docx-import/commit-service";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  AUTH_REQUIRED: "请先登录后再导入 DOCX。",
  MEMBER_REQUIRED: "当前账号没有导入权限。",
  ONBOARDING_REQUIRED: "请先完成站内资料设置后再导入 DOCX。",
  COMMIT_BODY_SIZE_LIMIT: "导入请求过大，请重新选择 DOCX。",
  IMPORT_BATCH_CONFLICT: "这份导入预览与已提交的内容不一致，请重新选择 DOCX。",
  ATTRIBUTED_USER_INVALID: "批注作者关联已失效，请重新选择。",
  ASSET_NOT_CLAIMABLE: "预览图片已失效，请重新导入 DOCX。",
  IMPORT_COMMIT_FAILED: "未能完成导入，请稍后重试。",
  DATABASE_UNAVAILABLE: "站点暂时无法保存导入内容，请稍后重试。",
};

export async function POST(request: Request) {
  const access = await getApiMemberAccess();
  if (!access.ok) {
    return Response.json({
      error: { code: access.code, message: errorMessages[access.code] },
    }, { status: access.status });
  }
  let input: unknown;
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (Number.isSafeInteger(length) && length > DOCX_IMPORT_LIMITS.commitBodyBytes) {
        throw new DocxImportBodyError("COMMIT_BODY_SIZE_LIMIT");
      }
    }
    input = parseDocxImportCommitBody(await request.text());
  } catch (error) {
    if (error instanceof DocxImportBodyError && error.code === "COMMIT_BODY_SIZE_LIMIT") {
      return Response.json({ error: { code: error.code, message: errorMessages[error.code] } }, { status: 413 });
    }
    return Response.json({ error: { code: "COMMIT_SCHEMA_INVALID", message: "导入请求格式无效。" } }, { status: 400 });
  }

  try {
    const result = await commitDocxImport(access.member.id, input);
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
