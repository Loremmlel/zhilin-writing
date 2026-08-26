"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdministrator } from "@/lib/auth/access";
import { validateLifecycleOperationId } from "@/lib/lifecycle/policy";
import { restorePostRevision } from "@/lib/revisions/service";

export async function restoreRevisionAction(postId: string, revisionId: string, formData: FormData) {
  const { member } = await requireAdministrator(`/admin/revisions/${postId}`);
  const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
  const newRevisionId = await restorePostRevision(postId, revisionId, member.id, operationId);
  revalidatePath(`/posts/${postId}`);
  revalidatePath(`/admin/revisions/${postId}`);
  redirect(`/admin/revisions/${postId}?revision=${encodeURIComponent(newRevisionId)}&restored=1`);
}
