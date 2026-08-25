import { requireMember } from "@/lib/auth/access";
import { storeTemporaryAsset } from "@/lib/assets/storage";
import { assetMarkdown } from "@/lib/domain/rules";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { member } = await requireMember("/");
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
    const message = error instanceof Error ? error.message : "上传失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
