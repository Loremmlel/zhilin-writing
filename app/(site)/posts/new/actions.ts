"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import { getApiMemberAccess } from "@/lib/auth/access";
import { actionAccessFailure } from "@/lib/actions/result";
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
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    const postId = await createPost(member.id, {
      title: String(formData.get("title") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      tags: parseTags(formData.get("tags")),
      attachmentIds: parseAttachmentIds(formData.get("attachmentIds")),
      submissionKey: String(formData.get("creationSubmissionKey") ?? ""),
    });
    revalidatePath("/");
    return { postId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "发布失败" };
  }
}
