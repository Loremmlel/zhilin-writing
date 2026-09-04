"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import { getApiMemberAccess } from "@/lib/auth/access";
import { actionAccessFailure } from "@/lib/actions/result";
import { logServerError } from "@/lib/logging";
import { createPost } from "@/lib/posts/service";

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

export async function createPostAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  let actorUserId: string | undefined;
  try {
    const access = await getApiMemberAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
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
    const incidentId = logServerError({
      operation: "post.create",
      userId: actorUserId,
      error,
      errorCode: "POST_CREATE_FAILED",
    });
    return { error: "发布失败，请稍后重试", incidentId };
  }
}
