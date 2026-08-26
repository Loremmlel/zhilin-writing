"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import type { ReplyActionState } from "@/components/reply-form";
import type { LifecycleActionState } from "@/components/lifecycle/delete-content-control";
import { requireMember } from "@/lib/auth/access";
import { deletePostByAuthor, deleteReplyByAuthor } from "@/lib/lifecycle/service";
import { createReply, updatePost } from "@/lib/posts/service";
import { EditConflictError } from "@/lib/revisions/service";

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
