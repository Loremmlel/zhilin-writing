"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import type { ReplyActionState } from "@/components/reply-form";
import type { LifecycleActionState } from "@/components/lifecycle/delete-content-control";
import { getApiMemberAccess } from "@/lib/auth/access";
import { actionAccessFailure, type ActionAccessErrorCode } from "@/lib/actions/result";
import {
  createAnnotation,
  createAnnotationReply,
  deleteAnnotationByAuthor,
  deleteAnnotationReplyByAuthor,
  removeImportedAnnotationThread,
} from "@/lib/annotations/service";
import { AnnotationIntegrityError } from "@/lib/annotations/save-plan";
import type { AnnotationSelectionDescriptor } from "@/lib/annotations/types";
import { deletePostByAuthor, deleteReplyByAuthor } from "@/lib/lifecycle/service";
import { createReply, updatePost } from "@/lib/posts/service";
import { EditConflictError } from "@/lib/revisions/service";
import { logServerError } from "@/lib/logging";

export type AnnotationActionState = {
  annotationId?: string;
  error?: string;
  code?: ActionAccessErrorCode;
};
export type AnnotationReplyActionState = {
  annotationReplyId?: string;
  error?: string;
  code?: ActionAccessErrorCode;
};

function parseAnnotationSelection(value: FormDataEntryValue | null): AnnotationSelectionDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch {
    throw new Error("批注选区无效，请重新选择文字");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("批注选区无效，请重新选择文字");
  const object = parsed as Record<string, unknown>;
  if (
    ["blockOrdinal", "endBlockOrdinal", "blockTextFrom", "blockTextTo"].some(
      (key) => !Number.isInteger(object[key]),
    ) ||
    typeof object.selectedText !== "string"
  )
    throw new Error("批注选区无效，请重新选择文字");
  return object as AnnotationSelectionDescriptor;
}

function parseTags(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseAttachmentIds(value: FormDataEntryValue | null): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function parseConfirmedAnnotationDeletionIds(value: FormDataEntryValue | null): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "[]"));
  } catch {
    throw new Error("已确认删除的批注标识无效");
  }
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string"))
    throw new Error("已确认删除的批注标识无效");
  return [...new Set(parsed)];
}

export async function updatePostAction(
  postId: string,
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    const result = await updatePost(postId, member.id, {
      title: String(formData.get("title") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      tags: parseTags(formData.get("tags")),
      attachmentIds: parseAttachmentIds(formData.get("attachmentIds")),
      baseRevisionId: String(formData.get("baseRevisionId") ?? ""),
      overwriteBaseRevisionId: String(formData.get("overwriteBaseRevisionId") ?? "") || undefined,
      confirmedAnnotationDeletionIds: parseConfirmedAnnotationDeletionIds(
        formData.get("confirmedAnnotationDeletionIds"),
      ),
    });
    revalidatePath(`/posts/${postId}`);
    return { postId, currentRevisionId: result.currentRevisionId };
  } catch (error) {
    if (error instanceof EditConflictError) {
      return { error: error.message, conflict: error.current };
    }
    if (error instanceof AnnotationIntegrityError)
      return { error: error.message, code: error.code };
    logServerError({
      operation: "post.update",
      entityId: postId,
      userId: actorUserId,
      error,
      errorCode: "POST_UPDATE_FAILED",
    });
    return { error: "保存失败，请稍后重试" };
  }
}

export async function createReplyAction(
  postId: string,
  targetReplyId: string | null,
  _state: ReplyActionState,
  formData: FormData,
): Promise<ReplyActionState> {
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    const replyId = await createReply({
      postId,
      authorId: member.id,
      markdown: String(formData.get("markdown") ?? ""),
      submissionKey: String(formData.get("submissionKey") ?? ""),
      targetReplyId: targetReplyId ?? undefined,
    });
    revalidatePath(`/posts/${postId}`);
    revalidatePath("/");
    return { replyId };
  } catch (error) {
    logServerError({
      operation: "post-reply.create",
      entityId: targetReplyId ?? postId,
      userId: actorUserId,
      error,
      errorCode: "POST_REPLY_CREATE_FAILED",
    });
    return { error: "回复失败，请稍后重试" };
  }
}

export async function createAnnotationAction(
  postId: string,
  _state: AnnotationActionState,
  formData: FormData,
): Promise<AnnotationActionState> {
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    const annotationId = await createAnnotation({
      postId,
      authorId: member.id,
      baseRevisionId: String(formData.get("baseRevisionId") ?? ""),
      selection: parseAnnotationSelection(formData.get("selection")),
      contentMarkdown: String(formData.get("contentMarkdown") ?? ""),
      submissionKey: String(formData.get("submissionKey") ?? ""),
    });
    revalidatePath(`/posts/${postId}`);
    revalidatePath("/");
    revalidatePath("/notifications");
    revalidatePath(`/users/${member.id}`);
    return { annotationId };
  } catch (error) {
    logServerError({
      operation: "annotation.create",
      entityId: postId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_CREATE_FAILED",
    });
    return { error: "批注发布失败，请稍后重试" };
  }
}

export async function createAnnotationReplyAction(
  postId: string,
  annotationId: string,
  targetReplyId: string | null,
  _state: AnnotationReplyActionState,
  formData: FormData,
): Promise<AnnotationReplyActionState> {
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    const annotationReplyId = await createAnnotationReply({
      postId,
      annotationId,
      authorId: member.id,
      targetReplyId: targetReplyId ?? undefined,
      contentMarkdown: String(formData.get("contentMarkdown") ?? ""),
      submissionKey: String(formData.get("submissionKey") ?? ""),
    });
    revalidatePath(`/posts/${postId}`);
    revalidatePath("/");
    revalidatePath("/notifications");
    revalidatePath(`/users/${member.id}`);
    return { annotationReplyId };
  } catch (error) {
    logServerError({
      operation: "annotation-reply.create",
      entityId: targetReplyId ?? annotationId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_REPLY_CREATE_FAILED",
    });
    return { error: "批注回复发布失败，请稍后重试" };
  }
}

export async function deletePostAction(
  postId: string,
  _state: LifecycleActionState,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    await deletePostByAuthor(postId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    logServerError({
      operation: "post.delete",
      entityId: postId,
      userId: actorUserId,
      error,
      errorCode: "POST_DELETE_FAILED",
    });
    return { error: "删除帖子失败，请稍后重试" };
  }
}

export async function deleteReplyAction(
  postId: string,
  replyId: string,
  _state: LifecycleActionState,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    await deleteReplyByAuthor(replyId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    logServerError({
      operation: "post-reply.delete",
      entityId: replyId,
      userId: actorUserId,
      error,
      errorCode: "POST_REPLY_DELETE_FAILED",
    });
    return { error: "删除回复失败，请稍后重试" };
  }
}

export async function deleteAnnotationAction(
  postId: string,
  annotationId: string,
  _state: LifecycleActionState,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    await deleteAnnotationByAuthor(postId, annotationId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    logServerError({
      operation: "annotation.delete",
      entityId: annotationId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_DELETE_FAILED",
    });
    return { error: "删除批注失败，请稍后重试" };
  }
}

export async function deleteAnnotationReplyAction(
  postId: string,
  replyId: string,
  _state: LifecycleActionState,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    await deleteAnnotationReplyByAuthor(postId, replyId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    logServerError({
      operation: "annotation-reply.delete",
      entityId: replyId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_REPLY_DELETE_FAILED",
    });
    return { error: "删除批注回复失败，请稍后重试" };
  }
}

export async function removeImportedAnnotationThreadAction(
  postId: string,
  annotationId: string,
  _state: LifecycleActionState,
): Promise<LifecycleActionState> {
  void _state;
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    await removeImportedAnnotationThread(postId, annotationId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    logServerError({
      operation: "annotation-import.remove",
      entityId: annotationId,
      userId: actorUserId,
      error,
      errorCode: "ANNOTATION_IMPORT_REMOVE_FAILED",
    });
    return { error: "移除 Word 导入批注失败，请稍后重试" };
  }
}
