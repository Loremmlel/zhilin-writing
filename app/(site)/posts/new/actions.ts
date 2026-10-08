"use server";

import { parsePostVisibilityField, PostVisibilityError } from "@/lib/posts/visibility";
import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/components/editor/post-editor-form";
import { getApiWritingAccess } from "@/lib/auth/access";
import { actionAccessFailure } from "@/lib/actions/result";
import { logServerError } from "@/lib/logging";
import { createPost, PostCreationConflictError } from "@/lib/posts/service";
import { PostInputError } from "@/lib/domain/rules";

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
    const access = await getApiWritingAccess();
    if (!access.ok) return actionAccessFailure(access.code);
    const { member } = access;
    actorUserId = member.id;
    const postId = await createPost(member.id, {
      visibilityUserIds: parsePostVisibilityField(formData.get("visibilityUserIds")),
      title: String(formData.get("title") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      tags: parseTags(formData.get("tags")),
      attachmentIds: parseAttachmentIds(formData.get("attachmentIds")),
      submissionKey: String(formData.get("creationSubmissionKey") ?? ""),
    });
    revalidatePath("/");
    return { postId };
  } catch (error) {
    if (error instanceof PostInputError) return { error: error.message, field: error.field };
    if (error instanceof PostCreationConflictError)
      return { error: error.message, code: error.code };
    if (error instanceof PostVisibilityError) return { error: error.message };
    const incidentId = logServerError({
      operation: "post.create",
      userId: actorUserId,
      error,
      errorCode: "POST_CREATE_FAILED",
    });
    return { error: "发布失败，请稍后重试", incidentId };
  }
}
