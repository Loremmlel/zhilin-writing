import { adminAuditDedupeKey, contentState } from "../lifecycle/policy.ts";

type AnnotationReplyLifecycleInput = {
  id: string;
  authorId: string | null;
  replyToReplyId: string | null;
  deletedAt: Date | null;
  hiddenAt: Date | null;
};

export function buildAnnotationReplyLifecycleViews<T extends AnnotationReplyLifecycleInput>(replies: T[]) {
  return replies.flatMap((reply) => {
    const state = contentState(reply).state;
    const dependents = replies.filter((candidate) => candidate.replyToReplyId === reply.id && contentState(candidate).state === "normal");
    if (state !== "normal" && dependents.length === 0) return [];
    return [{
      ...reply,
      state,
      contentVisible: state === "normal",
      placeholder: state === "hidden" ? "该回复已被管理员隐藏。" : state === "deleted" ? "该回复已被作者删除。" : null,
      visibleDependentCount: dependents.length,
      visibleOtherAuthorDependentCount: dependents.filter((candidate) => candidate.authorId !== reply.authorId).length,
    }];
  });
}

export function planAnnotationAuthorDelete(
  annotation: { authorId: string | null; deletedAt: Date | null },
  replies: Array<{ authorId: string | null; deletedAt: Date | null }>,
  actorUserId: string,
  now: Date,
) {
  if (annotation.authorId !== actorUserId) throw new Error("你不能删除这条批注");
  if (annotation.deletedAt) return { changed: false as const, retainAnchor: false, patch: {} };
  const retainAnchor = replies.some((reply) => reply.authorId !== actorUserId && !reply.deletedAt);
  return { changed: true as const, retainAnchor, patch: { deletedAt: now, deletedByUserId: actorUserId } };
}

type AdminTarget = {
  hiddenAt: Date | null;
};

export function planAnnotationAdminTransition(input: {
  targetType: "ANNOTATION" | "ANNOTATION_REPLY"; targetId: string; record: AdminTarget; administratorId: string;
  operation: "hide" | "unhide"; operationId: string; reason?: string; currentAnchor: boolean; now: Date;
}) {
  const hiding = input.operation === "hide";
  const changed = hiding ? !input.record.hiddenAt : Boolean(input.record.hiddenAt);
  if (!changed) return { changed: false as const, patch: {}, audit: null, createAnnotationStateRevision: false };
  const actionType: "ANNOTATION_HIDDEN" | "ANNOTATION_UNHIDDEN" | "ANNOTATION_REPLY_HIDDEN" | "ANNOTATION_REPLY_UNHIDDEN" = input.targetType === "ANNOTATION"
    ? (hiding ? "ANNOTATION_HIDDEN" : "ANNOTATION_UNHIDDEN")
    : (hiding ? "ANNOTATION_REPLY_HIDDEN" : "ANNOTATION_REPLY_UNHIDDEN");
  const patch = hiding
    ? { hiddenAt: input.now, hiddenByUserId: input.administratorId, hiddenReason: input.reason?.trim() || null }
    : { hiddenAt: null, hiddenByUserId: null, hiddenReason: null };
  return {
    changed: true as const,
    patch,
    createAnnotationStateRevision: input.targetType === "ANNOTATION" && input.currentAnchor,
    audit: {
      adminUserId: input.administratorId, actionType, targetType: input.targetType, targetId: input.targetId,
      createdAt: input.now, metadataJson: JSON.stringify({ reason: input.reason?.trim() || null }),
      dedupeKey: adminAuditDedupeKey(actionType, input.targetType, input.targetId, input.operationId),
    },
  };
}
