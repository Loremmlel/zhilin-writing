"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import { requireMember } from "@/lib/auth/access";
import { createPost } from "@/lib/posts/service";

function parseTags(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(/[，,]/).map((tag) => tag.trim()).filter(Boolean);
}

function parseAttachmentIds(value: FormDataEntryValue | null): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export async function createPostAction(_state: PostActionState, formData: FormData): Promise<PostActionState> {
  try {
    const { member } = await requireMember("/posts/new");
    const postId = await createPost(member.id, {
      title: String(formData.get("title") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      tags: parseTags(formData.get("tags")),
      attachmentIds: parseAttachmentIds(formData.get("attachmentIds")),
    });
    revalidatePath("/");
    return { postId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "发布失败" };
  }
}
