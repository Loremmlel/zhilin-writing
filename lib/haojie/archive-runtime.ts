import { env, waitUntil } from "cloudflare:workers";
import { measuredBucket } from "../performance/server";
import { logServerError } from "../logging";
import { getHaojieDb } from "./runtime";
import { archiveRoom } from "./archives";

export async function uploadRoomArchive(id: string) {
  if (!env.BUCKET) throw new Error("R2_UNAVAILABLE");
  return archiveRoom(getHaojieDb(), measuredBucket(env.BUCKET), id);
}

export function scheduleRoomArchive(id: string) {
  waitUntil(
    uploadRoomArchive(id).catch((error) => {
      logServerError({
        operation: "haojie.archive",
        entityId: id,
        error,
        errorCode: "HAOJIE_ARCHIVE_FAILED",
      });
    }),
  );
}
