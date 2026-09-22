"use server";

import { revalidatePath } from "next/cache";
import { getActionAdministratorAccess } from "@/lib/auth/access";
import { actionAccessFailure, type ActionAccessErrorCode } from "@/lib/actions/result";
import { logServerError } from "@/lib/logging";
import { abortRoom } from "@/lib/haojie/archives";
import { uploadRoomArchive } from "@/lib/haojie/archive-runtime";
import { getHaojieDb } from "@/lib/haojie/runtime";
import { parseRoomId } from "@/lib/haojie/input";
import { HaojieError } from "@/lib/haojie/contracts";

export type GameArchiveActionState = {
  success?: boolean;
  error?: string;
  incidentId?: string;
  code?: ActionAccessErrorCode;
};

export async function manageGameArchive(
  id: string,
  revision: number,
  operation: "abort" | "archive",
  _previous: GameArchiveActionState,
  _formData: FormData,
): Promise<GameArchiveActionState> {
  void _previous;
  void _formData;
  const access = await getActionAdministratorAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  let ended = false;
  try {
    parseRoomId(id);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !["abort", "archive"].includes(operation)
    )
      return { error: "操作无效，请刷新列表。" };
    if (operation === "abort") {
      await abortRoom(getHaojieDb(), id, access.member.id, revision);
      ended = true;
    }
    await uploadRoomArchive(id);
    revalidatePath("/admin/games");
    revalidatePath(`/games/haojie/${id}`);
    return { success: true };
  } catch (error) {
    if (error instanceof HaojieError) return { error: error.message };
    const incidentId = logServerError({
      operation: "haojie.admin-archive",
      entityId: id,
      userId: access.member.id,
      error,
      errorCode: "HAOJIE_ARCHIVE_FAILED",
    });
    return {
      error: ended
        ? "对局已结束，归档暂未完成。记录已保留，请重试。"
        : "归档失败，记录已保留，请重试。",
      incidentId,
    };
  }
}
