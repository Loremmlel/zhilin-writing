"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { addAllowedUser, findAllowedUser, removeAllowedUser } from "@/db/queries";
import { requireAdministrator } from "@/lib/auth/access";
import { normalizeEmail } from "@/lib/domain/rules";

export async function addAllowlistAction(formData: FormData) {
  const { member } = await requireAdministrator("/admin");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email || !email.includes("@")) redirect(`/admin?error=${encodeURIComponent("请输入有效邮箱")}`);
  if (!(await findAllowedUser(email))) await addAllowedUser(email, false, member.id);
  revalidatePath("/admin");
}

export async function removeAllowlistAction(formData: FormData) {
  await requireAdministrator("/admin");
  const id = String(formData.get("id") ?? "");
  if (id) await removeAllowedUser(id);
  revalidatePath("/admin");
}
