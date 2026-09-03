"use server";

import { redirect } from "next/navigation";

import { isDisplayNameTaken, updateUserProfile, updateUserProfileWithAvatar } from "@/db/queries";
import { storeTemporaryAsset } from "@/lib/assets/storage";
import { getApiMemberAccess } from "@/lib/auth/access";
import { actionAccessFailure, type ActionAccessErrorCode } from "@/lib/actions/result";
import { validateDisplayName } from "@/lib/domain/rules";
import { logServerError } from "@/lib/logging";

export type ProfileActionState = { error?: string; code?: ActionAccessErrorCode };

export async function updateProfileAction(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const access = await getApiMemberAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  const { member } = access;
  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 300);
  const error = validateDisplayName(displayName);
  if (error) return { error };
  const avatar = formData.get("avatar");
  if (avatar instanceof File && avatar.size > 0 && !avatar.type.startsWith("image/")) return { error: "头像必须是图片" };
  try {
    if (await isDisplayNameTaken(displayName, member.id)) return { error: "这个显示名称已经被使用" };
    if (avatar instanceof File && avatar.size > 0) {
      const asset = await storeTemporaryAsset(member.id, avatar, "avatar");
      await updateUserProfileWithAvatar(member.id, { displayName, bio }, asset.id);
    } else {
      await updateUserProfile(member.id, { displayName, bio });
    }
  } catch (caught) {
    logServerError({ operation: "profile.update", entityId: member.id, userId: member.id, error: caught, errorCode: "PROFILE_UPDATE_FAILED" });
    return { error: "资料保存失败，请稍后重试" };
  }
  redirect(`/users/${member.id}`);
}
