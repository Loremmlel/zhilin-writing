"use server";

import { revalidatePath } from "next/cache";

import { addAllowedUser, findAllowedUser, removeAllowedUser } from "@/db/queries";
import type { LifecycleActionState } from "@/components/lifecycle/delete-content-control";
import { getActionAdministratorAccess } from "@/lib/auth/access";
import { actionAccessFailure, type ActionAccessErrorCode } from "@/lib/actions/result";
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
import {
  moderateAnnotationByAdmin,
  moderateAnnotationReplyByAdmin,
} from "@/lib/annotations/service";
import { logServerError } from "@/lib/logging";

export type AllowlistActionState = {
  success?: boolean;
  error?: string;
  code?: ActionAccessErrorCode;
};

export async function addAllowlistAction(
  _state: AllowlistActionState,
  formData: FormData,
): Promise<AllowlistActionState> {
  const access = await getActionAdministratorAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  const { member } = access;
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email || !email.includes("@")) return { error: "请输入有效邮箱" };
  try {
    if (!(await findAllowedUser(email))) await addAllowedUser(email, false, member.id);
  } catch (error) {
    logServerError({
      operation: "allowlist.add",
      userId: member.id,
      error,
      errorCode: "ALLOWLIST_ADD_FAILED",
    });
    return { error: "白名单更新失败，请稍后重试" };
  }
  revalidatePath("/admin");
  return { success: true };
}

export async function removeAllowlistAction(
  _state: AllowlistActionState,
  formData: FormData,
): Promise<AllowlistActionState> {
  const access = await getActionAdministratorAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  const { member } = access;
  const id = String(formData.get("id") ?? "");
  try {
    if (id) await removeAllowedUser(id);
  } catch (error) {
    logServerError({
      operation: "allowlist.remove",
      entityId: id,
      userId: member.id,
      error,
      errorCode: "ALLOWLIST_REMOVE_FAILED",
    });
    return { error: "白名单更新失败，请稍后重试" };
  }
  revalidatePath("/admin");
  return { success: true };
}

export async function moderatePostAction(
  postId: string,
  operation: "hide" | "unhide" | "restore",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getActionAdministratorAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    const reason = String(formData.get("reason") ?? "");
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    if (operation === "hide") await hidePostByAdmin(postId, member.id, reason, operationId);
    if (operation === "unhide") await unhidePostByAdmin(postId, member.id, operationId);
    if (operation === "restore") await restorePostByAdmin(postId, member.id, operationId);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    logServerError({
      operation: `post.admin-${operation}`,
      entityId: postId,
      userId: actorUserId,
      error,
      errorCode: "POST_MODERATION_FAILED",
    });
    return { error: "帖子状态更新失败，请稍后重试" };
  }
}

export async function moderateReplyAction(
  replyId: string,
  operation: "hide" | "unhide" | "restore",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getActionAdministratorAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    const reason = String(formData.get("reason") ?? "");
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    if (operation === "hide") await hideReplyByAdmin(replyId, member.id, reason, operationId);
    if (operation === "unhide") await unhideReplyByAdmin(replyId, member.id, operationId);
    if (operation === "restore") await restoreReplyByAdmin(replyId, member.id, operationId);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    logServerError({
      operation: `post-reply.admin-${operation}`,
      entityId: replyId,
      userId: actorUserId,
      error,
      errorCode: "POST_REPLY_MODERATION_FAILED",
    });
    return { error: "回复状态更新失败，请稍后重试" };
  }
}

export async function moderateAnnotationAction(
  annotationId: string,
  operation: "hide" | "unhide",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getActionAdministratorAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
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
    logServerError({
      operation: `annotation.admin-${operation}`,
      entityId: annotationId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_MODERATION_FAILED",
    });
    return { error: "批注状态更新失败，请稍后重试" };
  }
}

export async function moderateAnnotationReplyAction(
  replyId: string,
  operation: "hide" | "unhide",
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getActionAdministratorAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
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
    logServerError({
      operation: `annotation-reply.admin-${operation}`,
      entityId: replyId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_REPLY_MODERATION_FAILED",
    });
    return { error: "批注回复状态更新失败，请稍后重试" };
  }
}
