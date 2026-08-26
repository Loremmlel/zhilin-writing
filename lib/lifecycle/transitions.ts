import { adminAuditDedupeKey } from "./policy.ts";

export type LifecycleRecord = {
  authorId: string;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  hiddenAt: Date | null;
  hiddenByUserId: string | null;
  hiddenReason: string | null;
};

export type AdminLifecycleAction =
  | "POST_HIDDEN"
  | "POST_UNHIDDEN"
  | "POST_RESTORED"
  | "REPLY_HIDDEN"
  | "REPLY_UNHIDDEN"
  | "REPLY_RESTORED";

export function planAuthorDelete(record: LifecycleRecord, actorUserId: string, now: Date) {
  if (record.authorId !== actorUserId) throw new Error("只能删除自己的内容");
  if (record.deletedAt) return { changed: false as const, patch: {} };
  return {
    changed: true as const,
    patch: { deletedAt: now, deletedByUserId: actorUserId },
  };
}

export function planAdminLifecycleTransition(
  actionType: AdminLifecycleAction,
  targetType: "POST" | "REPLY",
  targetId: string,
  record: LifecycleRecord,
  adminUserId: string,
  now: Date,
  reason?: string,
  operationId?: string,
) {
  const isHide = actionType.endsWith("_HIDDEN");
  const isUnhide = actionType.endsWith("_UNHIDDEN");
  const isRestore = actionType.endsWith("_RESTORED");
  if ((isHide && record.hiddenAt) || (isUnhide && !record.hiddenAt) || (isRestore && !record.deletedAt)) {
    return { changed: false as const, patch: {}, audit: null };
  }

  const priorTransitionAt = isHide ? null : isUnhide ? record.hiddenAt : record.deletedAt;
  const cleanReason = reason?.trim().slice(0, 300) || null;
  const patch = isHide
    ? { hiddenAt: now, hiddenByUserId: adminUserId, hiddenReason: cleanReason }
    : isUnhide
      ? { hiddenAt: null, hiddenByUserId: null, hiddenReason: null }
      : { deletedAt: null, deletedByUserId: null };

  return {
    changed: true as const,
    patch,
    audit: {
      actionType,
      targetType,
      targetId,
      adminUserId,
      createdAt: now,
      metadataJson: isHide && cleanReason ? JSON.stringify({ reason: cleanReason }) : null,
      dedupeKey: adminAuditDedupeKey(actionType, targetType, targetId, operationId || priorTransitionAt),
    },
  };
}
