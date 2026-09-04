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
import type { AdminContentType } from "@/lib/admin/query";
import { normalizeAdminSelection } from "@/lib/admin/purge-policy";
import { purgeContentByAdmin } from "@/lib/admin/purge-service";

export type AdminBulkActionState = LifecycleActionState & {
  succeeded?: number;
  skipped?: number;
  failed?: number;
};

async function hideContentByAdmin(
  type: AdminContentType,
  id: string,
  administratorId: string,
  reason: string,
  operationId: string,
) {
  if (type === "posts") return hidePostByAdmin(id, administratorId, reason, operationId);
  if (type === "replies") return hideReplyByAdmin(id, administratorId, reason, operationId);
  if (type === "annotations")
    return moderateAnnotationByAdmin({
      annotationId: id,
      administratorId,
      operation: "hide",
      operationId,
      reason,
    });
  return moderateAnnotationReplyByAdmin({
    replyId: id,
    administratorId,
    operation: "hide",
    operationId,
    reason,
  });
}

export type AllowlistActionState = {
  success?: boolean;
  error?: string;
  code?: ActionAccessErrorCode;
  incidentId?: string;
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
    const incidentId = logServerError({
      operation: "allowlist.add",
      userId: member.id,
      error,
      errorCode: "ALLOWLIST_ADD_FAILED",
    });
    return { error: "白名单更新失败，请稍后重试", incidentId };
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
    const incidentId = logServerError({
      operation: "allowlist.remove",
      entityId: id,
      userId: member.id,
      error,
      errorCode: "ALLOWLIST_REMOVE_FAILED",
    });
    return { error: "白名单更新失败，请稍后重试", incidentId };
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
    const incidentId = logServerError({
      operation: `post.admin-${operation}`,
      entityId: postId,
      userId: actorUserId,
      error,
      errorCode: "POST_MODERATION_FAILED",
    });
    return { error: "帖子状态更新失败，请稍后重试", incidentId };
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
    const incidentId = logServerError({
      operation: `post-reply.admin-${operation}`,
      entityId: replyId,
      userId: actorUserId,
      error,
      errorCode: "POST_REPLY_MODERATION_FAILED",
    });
    return { error: "回复状态更新失败，请稍后重试", incidentId };
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
    const incidentId = logServerError({
      operation: `annotation.admin-${operation}`,
      entityId: annotationId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_MODERATION_FAILED",
    });
    return { error: "批注状态更新失败，请稍后重试", incidentId };
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
    const incidentId = logServerError({
      operation: `annotation-reply.admin-${operation}`,
      entityId: replyId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_REPLY_MODERATION_FAILED",
    });
    return { error: "批注回复状态更新失败，请稍后重试", incidentId };
  }
}

export async function purgeContentAction(
  type: AdminContentType,
  id: string,
  _state: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getActionAdministratorAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    actorUserId = access.member.id;
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    await purgeContentByAdmin(type, id, actorUserId, operationId);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    const incidentId = logServerError({
      operation: `admin.${type}.purge`,
      entityId: id,
      userId: actorUserId,
      error,
      errorCode: "ADMIN_CONTENT_PURGE_FAILED",
    });
    return { error: "内容永久删除失败，请稍后重试", incidentId };
  }
}

export async function bulkManageContentAction(
  type: AdminContentType,
  _state: AdminBulkActionState,
  formData: FormData,
): Promise<AdminBulkActionState> {
  void _state;
  const access = await getActionAdministratorAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  const operation = String(formData.get("operation") ?? "");
  if (operation !== "hide" && operation !== "purge") return { error: "批量操作无效" };
  let ids: string[];
  let operationId: string;
  try {
    ids = normalizeAdminSelection(formData.getAll("ids").map(String));
    operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "批量操作无效" };
  }
  const reason = String(formData.get("reason") ?? "")
    .trim()
    .slice(0, 300);
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let incidentId: string | undefined;
  for (const id of ids) {
    try {
      const result =
        operation === "hide"
          ? await hideContentByAdmin(type, id, access.member.id, reason, operationId)
          : await purgeContentByAdmin(type, id, access.member.id, operationId);
      if (typeof result === "boolean" ? result : result.changed) succeeded += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      incidentId ??= logServerError({
        operation: `admin.${type}.bulk-${operation}`,
        entityId: id,
        userId: access.member.id,
        error,
        errorCode: "ADMIN_CONTENT_BULK_FAILED",
      });
    }
  }
  if (succeeded) revalidatePath("/", "layout");
  return {
    success: failed === 0,
    succeeded,
    skipped,
    failed,
    error: failed ? `有 ${failed} 条处理失败，请稍后重试` : undefined,
    incidentId,
  };
}
