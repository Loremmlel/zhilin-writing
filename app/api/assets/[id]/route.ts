import { findAsset } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";
import { canReadAsset } from "@/lib/assets/access-service";
import { getStoredObject } from "@/lib/assets/storage";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { member, allowed } = await requireMember("/");
  const { id } = await context.params;
  const asset = await findAsset(id);
  if (!asset || !(await canReadAsset(id, { userId: member.id, isAdmin: allowed.isAdmin }))) {
    return new Response("Not found", { status: 404 });
  }
  const object = await getStoredObject(asset.r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", asset.mimeType);
  headers.set("content-length", String(asset.byteSize));
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
  headers.set("cache-control", asset.status === "permanent" ? "private, max-age=86400" : "private, no-store");
  return new Response(object.body, { headers });
}
