"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getActionAdministratorAccess } from "@/lib/auth/access";
import { actionAccessFailure, type ActionAccessErrorCode } from "@/lib/actions/result";
import { validateLifecycleOperationId } from "@/lib/lifecycle/policy";
import { restorePostRevision } from "@/lib/revisions/service";

export type RestoreRevisionActionState = { error?: string; code?: ActionAccessErrorCode };

export async function restoreRevisionAction(postId: string, revisionId: string, _previous: RestoreRevisionActionState, formData: FormData): Promise<RestoreRevisionActionState> {
  void _previous;
  const access = await getActionAdministratorAccess();
  if (!access.ok) return actionAccessFailure(access.code);
  const { member } = access;
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
