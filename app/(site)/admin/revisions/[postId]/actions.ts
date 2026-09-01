"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdministrator } from "@/lib/auth/access";
import { validateLifecycleOperationId } from "@/lib/lifecycle/policy";
import { restorePostRevision } from "@/lib/revisions/service";

export type RestoreRevisionActionState = { error?: string };

export async function restoreRevisionAction(postId: string, revisionId: string, _previous: RestoreRevisionActionState, formData: FormData): Promise<RestoreRevisionActionState> {
  void _previous;
  const { member } = await requireAdministrator(`/admin/revisions/${postId}`);
  let newRevisionId: string;
  try {
    const operationId = validateLifecycleOperationId(String(formData.get("operationId") ?? ""));
    newRevisionId = await restorePostRevision(postId, revisionId, member.id, operationId);
  } catch {
    return { error: "恢复失败，请稍后重试" };
  }
  revalidatePath(`/posts/${postId}`);
  revalidatePath(`/admin/revisions/${postId}`);
  redirect(`/admin/revisions/${postId}?revision=${encodeURIComponent(newRevisionId)}&restored=1`);
}
