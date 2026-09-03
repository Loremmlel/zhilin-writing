import { getApiMemberAccess } from "@/lib/auth/access";
import { accessErrorMessage } from "@/lib/actions/result";
import { storeTemporaryAsset } from "@/lib/assets/storage";
import { AssetStorageError } from "@/lib/assets/errors";
import { assetMarkdown } from "@/lib/domain/rules";
import { logServerError } from "@/lib/logging";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return Response.json({ error: accessErrorMessage(access.code), code: access.code }, { status: access.status });
    const { member } = access;
    actorUserId = member.id;
    const formData = await request.formData();
    const value = formData.get("file");
    if (!(value instanceof File)) {
      return Response.json({ error: "请选择文件" }, { status: 400 });
    }
    const kind = formData.get("kind") === "avatar" ? "avatar" : undefined;
    const asset = await storeTemporaryAsset(member.id, value, kind);
    const url = `/api/assets/${asset.id}`;
    return Response.json({
      asset: { ...asset, url },
      markdown: asset.kind === "avatar" ? null : assetMarkdown({ kind: asset.kind, filename: asset.filename, url }),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AssetStorageError) {
      const status = error.code === "SERVER_FAILURE" ? 503 : 400;
      if (status >= 500) logServerError({ operation: "asset.upload", userId: actorUserId, error });
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    logServerError({ operation: "asset.upload", userId: actorUserId, error, errorCode: "ASSET_UPLOAD_FAILED" });
    return Response.json({ error: "文件上传失败，请稍后重试", code: "SERVER_FAILURE" }, { status: 500 });
  }
}
