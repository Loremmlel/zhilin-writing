import { env } from "cloudflare:workers";
import { getActionAdministratorAccess } from "@/lib/auth/access";
import { accessErrorMessage } from "@/lib/actions/result";
import { archiveRoomInfo } from "@/lib/haojie/archives";
import { getHaojieDb } from "@/lib/haojie/runtime";
import { parseRoomId } from "@/lib/haojie/input";
import { HaojieError } from "@/lib/haojie/contracts";
import { measuredBucket } from "@/lib/performance/server";
import { logServerError } from "@/lib/logging";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  let id: string | undefined;
  try {
    const access = await getActionAdministratorAccess();
    if (!access.ok)
      return Response.json(
        { error: accessErrorMessage(access.code) },
        { status: access.status, headers },
      );
    id = parseRoomId((await params).id);
    const room = await archiveRoomInfo(getHaojieDb(), id);
    if (!room.archiveKey)
      return Response.json({ error: "档案尚未生成，请返回列表归档。" }, { status: 409, headers });
    const object = await measuredBucket(env.BUCKET).get(room.archiveKey);
    if (!object) throw new Error("HAOJIE_ARCHIVE_MISSING");
    return new Response(object.body, {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="haojie-${id}.json"`,
        "Content-Length": String(object.size),
      },
    });
  } catch (error) {
    if (error instanceof HaojieError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    const incidentId = logServerError({
      operation: "haojie.archive-download",
      entityId: id,
      error,
      errorCode: "HAOJIE_ARCHIVE_DOWNLOAD_FAILED",
    });
    return Response.json({ error: "下载失败，请稍后重试。", incidentId }, { status: 500, headers });
  }
}
