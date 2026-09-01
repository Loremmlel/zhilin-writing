"use server";

import { revalidatePath } from "next/cache";

import { markAllNotificationsRead } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";

export type NotificationActionState = { success?: boolean; error?: string };

export async function markAllNotificationsReadAction(_previous: NotificationActionState, _formData: FormData): Promise<NotificationActionState> {
  void _previous;
  void _formData;
  const { member } = await requireMember("/notifications");
  try {
    await markAllNotificationsRead(member.id);
  } catch {
    return { error: "未能标记通知，请稍后重试" };
  }
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return { success: true };
}
