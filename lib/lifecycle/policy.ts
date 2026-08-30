export type ContentState = "normal" | "deleted" | "hidden";

type LifecycleFlags = {
  deletedAt: Date | null;
  hiddenAt: Date | null;
};

export function contentState(flags: LifecycleFlags) {
  return {
    state: flags.hiddenAt ? "hidden" as const : flags.deletedAt ? "deleted" as const : "normal" as const,
    userDeleted: Boolean(flags.deletedAt),
    adminHidden: Boolean(flags.hiddenAt),
  };
}

export function shouldRenderReplyPlaceholder(input: {
  state: ContentState;
  visibleDependentCount: number;
}) {
  return input.state !== "normal" && input.visibleDependentCount > 0;
}

export function isPostDiscussionReachable(
  postAuthorId: string,
  replies: Array<{ authorId: string | null; deletedAt: Date | null; hiddenAt: Date | null }>,
) {
  return replies.some((reply) => (
    reply.authorId !== null
    && reply.authorId !== postAuthorId
    && contentState(reply).state === "normal"
  ));
}

export function deriveLastActivityAt(
  postPublishedAt: Date,
  replies: Array<{ publishedAt: Date; deletedAt: Date | null; hiddenAt: Date | null }>,
) {
  return replies.reduce((latest, reply) => {
    if (contentState(reply).state !== "normal") return latest;
    return reply.publishedAt > latest ? reply.publishedAt : latest;
  }, postPublishedAt);
}

type AssetGcInput = {
  status: "temporary" | "permanent";
  currentRefCount: number;
  revisionRefCount: number;
  avatarRefCount: number;
  expiresAt: Date | null;
  now: Date;
};

export function assetGcEligibility(input: AssetGcInput): "eligible" | "referenced" | "temporary-not-expired" {
  if (input.currentRefCount > 0 || input.revisionRefCount > 0 || input.avatarRefCount > 0) return "referenced";
  if (input.status === "temporary" && (!input.expiresAt || input.expiresAt > input.now)) return "temporary-not-expired";
  return "eligible";
}

export function adminAuditDedupeKey(
  actionType: string,
  targetType: string,
  targetId: string,
  transitionIdentity: Date | string | null,
) {
  const identity = transitionIdentity instanceof Date ? transitionIdentity.getTime() : transitionIdentity ?? "active";
  return [actionType, targetType, targetId, identity].join(":");
}

export function deletePostConfirmation(hasOtherMemberDiscussion: boolean) {
  return hasOtherMemberDiscussion
    ? "删除后你的帖子正文将被撤下，但其他用户已经发布的回复仍会保留。"
    : "删除后帖子将从普通页面撤下。如需恢复，请联系管理员。";
}

export function deleteReplyConfirmation(hasDependentReplies: boolean) {
  return hasDependentReplies
    ? "删除后你的回复内容将被隐藏，但其他用户的回复仍然保留。"
    : "删除后这条回复将从讨论中撤下。如需恢复，请联系管理员。";
}

export function validateLifecycleOperationId(value: string) {
  const operationId = value.trim().toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) {
    throw new Error("操作标识无效，请刷新页面后重试");
  }
  return operationId;
}

export function canExposeActivitySnapshot(
  postState: ContentState,
  eventType: "POST_CREATED" | "POST_REPLY_CREATED" | "ANNOTATION_CREATED" | "ANNOTATION_REPLY_CREATED",
  replyState: ContentState,
) {
  return postState === "normal" && (eventType === "POST_CREATED" || replyState === "normal");
}
