"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { markAllNotificationsRead } from "@/db/queries";
import { requireMember } from "@/lib/auth/access";

export async function markAllNotificationsReadAction() {
  const { member } = await requireMember("/notifications");
  await markAllNotificationsRead(member.id);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  redirect("/notifications");
}
