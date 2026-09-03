"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { isDisplayNameTaken, updateUserProfile } from "@/db/queries";
import { assets } from "@/db/schema";
import { storeTemporaryAsset } from "@/lib/assets/storage";
import { getApiMemberAccess } from "@/lib/auth/access";
import { actionAccessFailure, type ActionAccessErrorCode } from "@/lib/actions/result";
import { validateDisplayName } from "@/lib/domain/rules";

export type ProfileActionState = { error?: string; code?: ActionAccessErrorCode };

export async function updateProfileAction(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const access = await getApiMemberAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  const { member } = access;
  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 300);
  const error = validateDisplayName(displayName);
  if (error) return { error };
  let avatarAssetId = member.avatarAssetId;
  const avatar = formData.get("avatar");
  if (avatar instanceof File && avatar.size > 0 && !avatar.type.startsWith("image/")) return { error: "头像必须是图片" };
  try {
    if (await isDisplayNameTaken(displayName, member.id)) return { error: "这个显示名称已经被使用" };
    if (avatar instanceof File && avatar.size > 0) {
      const asset = await storeTemporaryAsset(member.id, avatar, "avatar");
      avatarAssetId = asset.id;
      await getDb().update(assets).set({ status: "permanent", boundAt: new Date(), expiresAt: null }).where(and(eq(assets.id, asset.id), eq(assets.ownerId, member.id)));
    }
    await updateUserProfile(member.id, { displayName, bio, avatarAssetId });
  } catch {
    return { error: "资料保存失败，请稍后重试" };
  }
  redirect(`/users/${member.id}`);
}
