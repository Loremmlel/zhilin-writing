import { getApiMemberAccess } from "../auth/access";
import { accessErrorMessage } from "../actions/result";
import { logServerError } from "../logging";
import { parsePage } from "../pagination";
import { HaojieError } from "./contracts";
import {
  parseAfter,
  parseCreate,
  parseMutation,
  parseReaction,
  parseRoomId,
  readRoomBody,
} from "./input";
import { getHaojieDb, isHaojieEnabled } from "./runtime";
import { createRoom, getRoom, listRooms, mutateRoom, sendReactions } from "./service";

const headers = { "Cache-Control": "private, no-store" };
type Operation = "list" | "create" | "read" | "join" | "command" | "finish" | "reaction" | "undo";

export async function haojieApi(request: Request, operation: Operation, roomId?: string) {
  let actor: string | undefined;
  try {
    if (!isHaojieEnabled())
      return Response.json(
        { error: { code: "GAME_UNAVAILABLE", message: "浩劫 2 暂不可用。" } },
        { status: 404, headers },
      );
    const access = await getApiMemberAccess();
    if (!access.ok)
      return Response.json(
        { error: { code: access.code, message: accessErrorMessage(access.code) } },
        { status: access.status, headers },
      );
    actor = access.member.id;
    const db = getHaojieDb();
    if (roomId) parseRoomId(roomId);
    const url = new URL(request.url);
    if (operation === "list")
      return Response.json(await listRooms(db, actor, parsePage(url.searchParams.get("page"))), {
        headers,
      });
    if (operation === "read") {
      const result = await getRoom(
        db,
        roomId!,
        actor,
        parseAfter(url.searchParams.get("after")),
        url.searchParams.has("afterReaction")
          ? parseAfter(url.searchParams.get("afterReaction"))
          : undefined,
      );
      return result
        ? Response.json(result, { headers })
        : new Response(null, { status: 204, headers });
    }
    const body = await readRoomBody(request);
    if (operation === "reaction")
      return Response.json(await sendReactions(db, roomId!, actor, parseReaction(body).items), {
        headers,
      });
    if (operation === "create") {
      const input = parseCreate(body);
      return Response.json(await createRoom(db, actor, input.requestId, input.mode), { headers });
    }
    return Response.json(await mutateRoom(db, roomId!, actor, parseMutation(operation, body)), {
      headers,
    });
  } catch (error) {
    if (error instanceof HaojieError) {
      let snapshot;
      if (error.status === 409 && actor && roomId) {
        try {
          snapshot = await getRoom(getHaojieDb(), roomId, actor);
        } catch {
          /* A conflict never broadens access or masks the original result. */
        }
      }
      return Response.json(
        { error: { code: error.code, message: error.message }, snapshot },
        { status: error.status, headers },
      );
    }
    const incidentId = logServerError({
      operation: `haojie.${operation}`,
      entityId: roomId,
      userId: actor,
      error,
      errorCode: "HAOJIE_REQUEST_FAILED",
    });
    return Response.json(
      { error: { code: "SERVER_FAILURE", message: "暂时无法完成操作，请重新连接。", incidentId } },
      { status: 500, headers },
    );
  }
}
