"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import type { ReplyActionState } from "@/components/reply-form";
import type { LifecycleActionState } from "@/components/lifecycle/delete-content-control";
import { requireMember } from "@/lib/auth/access";
import { createAnnotation, createAnnotationReply, deleteAnnotationByAuthor, deleteAnnotationReplyByAuthor, removeImportedAnnotationThread } from "@/lib/annotations/service";
import type { AnnotationSelectionDescriptor } from "@/lib/annotations/types";
import { deletePostByAuthor, deleteReplyByAuthor } from "@/lib/lifecycle/service";
import { createReply, updatePost } from "@/lib/posts/service";
import { EditConflictError } from "@/lib/revisions/service";

export type AnnotationActionState = { annotationId?: string; error?: string };
export type AnnotationReplyActionState = { annotationReplyId?: string; error?: string };

function parseAnnotationSelection(value: FormDataEntryValue | null): AnnotationSelectionDescriptor {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value ?? "")); } catch { throw new Error("批注选区无效，请重新选择文字"); }
  if (!parsed || typeof parsed !== "object") throw new Error("批注选区无效，请重新选择文字");
  const object = parsed as Record<string, unknown>;
  if (["blockOrdinal", "endBlockOrdinal", "blockTextFrom", "blockTextTo"].some((key) => !Number.isInteger(object[key])) || typeof object.selectedText !== "string") throw new Error("批注选区无效，请重新选择文字");
  return object as AnnotationSelectionDescriptor;
}

function parseTags(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(/[，,]/).map((tag) => tag.trim()).filter(Boolean);
}

function parseAttachmentIds(value: FormDataEntryValue | null): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export async function updatePostAction(postId: string, _state: PostActionState, formData: FormData): Promise<PostActionState> {
  try {
    const { member } = await requireMember(`/posts/${postId}/edit`);
    const result = await updatePost(postId, member.id, {
      title: String(formData.get("title") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      tags: parseTags(formData.get("tags")),
      attachmentIds: parseAttachmentIds(formData.get("attachmentIds")),
      baseRevisionId: String(formData.get("baseRevisionId") ?? ""),
      overwriteBaseRevisionId: String(formData.get("overwriteBaseRevisionId") ?? "") || undefined,
    });
    revalidatePath(`/posts/${postId}`);
    return { postId, currentRevisionId: result.currentRevisionId };
  } catch (error) {
    if (error instanceof EditConflictError) {
      return { error: error.message, conflict: error.current };
    }
    return { error: error instanceof Error ? error.message : "保存失败" };
  }
}

export async function createReplyAction(postId: string, targetReplyId: string | null, _state: ReplyActionState, formData: FormData): Promise<ReplyActionState> {
  try {
    const { member } = await requireMember(`/posts/${postId}`);
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
    return { error: error instanceof Error ? error.message : "回复失败" };
  }
}

export async function createAnnotationAction(postId: string, _state: AnnotationActionState, formData: FormData): Promise<AnnotationActionState> {
  try {
    const { member } = await requireMember(`/posts/${postId}`);
    const annotationId = await createAnnotation({ postId, authorId: member.id, baseRevisionId: String(formData.get("baseRevisionId") ?? ""), selection: parseAnnotationSelection(formData.get("selection")), contentMarkdown: String(formData.get("contentMarkdown") ?? ""), submissionKey: String(formData.get("submissionKey") ?? "") });
    revalidatePath(`/posts/${postId}`); revalidatePath("/"); revalidatePath("/notifications"); revalidatePath(`/users/${member.id}`);
    return { annotationId };
  } catch (error) { return { error: error instanceof Error ? error.message : "批注发布失败" }; }
}

export async function createAnnotationReplyAction(postId: string, annotationId: string, targetReplyId: string | null, _state: AnnotationReplyActionState, formData: FormData): Promise<AnnotationReplyActionState> {
  try {
    const { member } = await requireMember(`/posts/${postId}`);
    const annotationReplyId = await createAnnotationReply({ postId, annotationId, authorId: member.id, targetReplyId: targetReplyId ?? undefined, contentMarkdown: String(formData.get("contentMarkdown") ?? ""), submissionKey: String(formData.get("submissionKey") ?? "") });
    revalidatePath(`/posts/${postId}`); revalidatePath("/"); revalidatePath("/notifications"); revalidatePath(`/users/${member.id}`);
    return { annotationReplyId };
  } catch (error) { return { error: error instanceof Error ? error.message : "批注回复发布失败" }; }
}

export async function deletePostAction(postId: string, _state: LifecycleActionState): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireMember(`/posts/${postId}`);
    await deletePostByAuthor(postId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "删除帖子失败" };
  }
}

export async function deleteReplyAction(postId: string, replyId: string, _state: LifecycleActionState): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireMember(`/posts/${postId}`);
    await deleteReplyByAuthor(replyId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "删除回复失败" };
  }
}

export async function deleteAnnotationAction(postId: string, annotationId: string, _state: LifecycleActionState): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireMember(`/posts/${postId}`);
    await deleteAnnotationByAuthor(postId, annotationId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "删除批注失败" }; }
}

export async function deleteAnnotationReplyAction(postId: string, replyId: string, _state: LifecycleActionState): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireMember(`/posts/${postId}`);
    await deleteAnnotationReplyByAuthor(postId, replyId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "删除批注回复失败" }; }
}

export async function removeImportedAnnotationThreadAction(postId: string, annotationId: string, _state: LifecycleActionState): Promise<LifecycleActionState> {
  void _state;
  try {
    const { member } = await requireMember(`/posts/${postId}`);
    await removeImportedAnnotationThread(postId, annotationId, member.id);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "移除 Word 导入批注失败" }; }
}
