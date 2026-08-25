"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import type { ReplyActionState } from "@/components/reply-form";
import { requireMember } from "@/lib/auth/access";
import { createReply, softDeleteReply, updatePost } from "@/lib/posts/service";

function parseTags(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(/[，,]/).map((tag) => tag.trim()).filter(Boolean);
}

function parseAssetIds(value: FormDataEntryValue | null): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export async function updatePostAction(postId: string, _state: PostActionState, formData: FormData): Promise<PostActionState> {
  try {
    const { member } = await requireMember(`/posts/${postId}/edit`);
    await updatePost(postId, member.id, {
      title: String(formData.get("title") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      tags: parseTags(formData.get("tags")),
      assetIds: parseAssetIds(formData.get("assetIds")),
    });
    revalidatePath(`/posts/${postId}`);
    return { postId };
  } catch (error) {
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

export async function deleteReplyAction(postId: string, replyId: string) {
  const { member } = await requireMember(`/posts/${postId}`);
  await softDeleteReply(replyId, member.id);
  revalidatePath(`/posts/${postId}`);
}
