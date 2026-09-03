"use server";

import { revalidatePath } from "next/cache";

import { markAllNotificationsRead } from "@/db/queries";
import { getApiMemberAccess } from "@/lib/auth/access";
import { actionAccessFailure, type ActionAccessErrorCode } from "@/lib/actions/result";
import { logServerError } from "@/lib/logging";

export type NotificationActionState = { success?: boolean; error?: string; code?: ActionAccessErrorCode };

export async function markAllNotificationsReadAction(_previous: NotificationActionState, _formData: FormData): Promise<NotificationActionState> {
  void _previous;
  void _formData;
  const access = await getApiMemberAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  const { member } = access;
  try {
    await markAllNotificationsRead(member.id);
  } catch (error) {
    logServerError({ operation: "notification.mark-all-read", userId: member.id, error, errorCode: "NOTIFICATION_MARK_READ_FAILED" });
    return { error: "未能标记通知，请稍后重试" };
  }
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return { success: true };
}
