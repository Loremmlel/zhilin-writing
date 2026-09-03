import { findAsset } from "@/db/queries";
import { getApiMemberAccess } from "@/lib/auth/access";
import { accessErrorMessage } from "@/lib/actions/result";
import { canReadAsset } from "@/lib/assets/access-service";
import { getStoredObject } from "@/lib/assets/storage";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await getApiMemberAccess();
  if (!access.ok) return Response.json({ error: accessErrorMessage(access.code), code: access.code }, { status: access.status });
  const { member, allowed } = access;
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
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-length", String(asset.byteSize));
  const disposition = asset.kind === "image" || asset.kind === "avatar" ? "inline" : "attachment";
  headers.set("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
  headers.set("cache-control", asset.status === "permanent" ? "private, max-age=86400" : "private, no-store");
  return new Response(object.body, { headers });
}
