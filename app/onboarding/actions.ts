"use server";

import { redirect } from "next/navigation";

import { createUserProfile, isDisplayNameTaken } from "@/db/queries";
import { requireSiteAccess } from "@/lib/auth/access";
import { validateDisplayName } from "@/lib/domain/rules";

export async function createProfileAction(formData: FormData) {
  const access = await requireSiteAccess("/onboarding");
  if (access.member) redirect("/");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "")
    .trim()
    .slice(0, 300);
  const error = validateDisplayName(displayName);
  if (error) redirect(`/onboarding?error=${encodeURIComponent(error)}`);
  if (await isDisplayNameTaken(displayName))
    redirect(`/onboarding?error=${encodeURIComponent("这个显示名称已经被使用")}`);
  await createUserProfile({ emailKey: access.emailKey, displayName, bio });
  redirect("/");
}
