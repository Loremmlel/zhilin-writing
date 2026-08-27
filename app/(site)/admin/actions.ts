"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { addAllowedUser, findAllowedUser, removeAllowedUser } from "@/db/queries";
import type { LifecycleActionState } from "@/components/lifecycle/delete-content-control";
import { requireAdministrator } from "@/lib/auth/access";
import { normalizeEmail } from "@/lib/domain/rules";
import {
  hidePostByAdmin,
  hideReplyByAdmin,
  restorePostByAdmin,
  restoreReplyByAdmin,
  unhidePostByAdmin,
  unhideReplyByAdmin,
} from "@/lib/lifecycle/service";
import { validateLifecycleOperationId } from "@/lib/lifecycle/policy";
import { moderateAnnotationByAdmin, moderateAnnotationReplyByAdmin } from "@/lib/annotations/service";

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

export async function moderatePostAction(
  postId: string,
  operation: "hide" | "unhide" | "restore",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireAdministrator("/admin");
    const reason = String(formData.get("reason") ?? "");
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    if (operation === "hide") await hidePostByAdmin(postId, member.id, reason, operationId);
    if (operation === "unhide") await unhidePostByAdmin(postId, member.id, operationId);
    if (operation === "restore") await restorePostByAdmin(postId, member.id, operationId);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "帖子状态更新失败" };
  }
}

export async function moderateReplyAction(
  replyId: string,
  operation: "hide" | "unhide" | "restore",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireAdministrator("/admin");
    const reason = String(formData.get("reason") ?? "");
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    if (operation === "hide") await hideReplyByAdmin(replyId, member.id, reason, operationId);
    if (operation === "unhide") await unhideReplyByAdmin(replyId, member.id, operationId);
    if (operation === "restore") await restoreReplyByAdmin(replyId, member.id, operationId);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "回复状态更新失败" };
  }
}

export async function moderateAnnotationAction(
  annotationId: string,
  operation: "hide" | "unhide",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireAdministrator("/admin");
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    await moderateAnnotationByAdmin({
      annotationId,
      administratorId: member.id,
      operation,
      operationId,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "批注状态更新失败" };
  }
}

export async function moderateAnnotationReplyAction(
  replyId: string,
  operation: "hide" | "unhide",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireAdministrator("/admin");
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    await moderateAnnotationReplyByAdmin({
      replyId,
      administratorId: member.id,
      operation,
      operationId,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "批注回复状态更新失败" };
  }
}
