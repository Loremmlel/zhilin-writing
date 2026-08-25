"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { isDisplayNameTaken, updateUserProfile } from "@/db/queries";
import { assets } from "@/db/schema";
import { storeTemporaryAsset } from "@/lib/assets/storage";
import { requireMember } from "@/lib/auth/access";
import { validateDisplayName } from "@/lib/domain/rules";

export async function updateProfileAction(formData: FormData) {
  const { member } = await requireMember("/settings/profile");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 300);
  const error = validateDisplayName(displayName);
  if (error) redirect(`/settings/profile?error=${encodeURIComponent(error)}`);
  if (await isDisplayNameTaken(displayName, member.id)) redirect(`/settings/profile?error=${encodeURIComponent("这个显示名称已经被使用")}`);
  let avatarAssetId = member.avatarAssetId;
  const avatar = formData.get("avatar");
  if (avatar instanceof File && avatar.size > 0) {
    if (!avatar.type.startsWith("image/")) redirect(`/settings/profile?error=${encodeURIComponent("头像必须是图片")}`);
    const asset = await storeTemporaryAsset(member.id, avatar, "avatar");
    avatarAssetId = asset.id;
    await getDb().update(assets).set({ status: "permanent", boundAt: new Date(), expiresAt: null }).where(and(eq(assets.id, asset.id), eq(assets.ownerId, member.id)));
  }
  await updateUserProfile(member.id, { displayName, bio, avatarAssetId });
  redirect(`/users/${member.id}`);
}
