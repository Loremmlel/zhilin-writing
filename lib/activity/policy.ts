export const activityEventTypes = ["POST_CREATED", "POST_REPLY_CREATED"] as const;
export type ActivityEventType = (typeof activityEventTypes)[number];

export const notificationTypes = ["POST_REPLY_RECEIVED"] as const;
export type NotificationType = (typeof notificationTypes)[number];

function kebabCase(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("_", "-");
}

export function activityEventId(eventType: ActivityEventType, postId: string, replyId?: string): string {
  if (eventType === "POST_CREATED") return `activity:post:${postId}:created`;
  if (!replyId) throw new Error("回复事件缺少 replyId");
  return `activity:reply:${replyId}:created`;
}

export function notificationId(eventId: string, recipientUserId: string, type: NotificationType): string {
  return `notification:${eventId}:${recipientUserId}:${kebabCase(type)}`;
}

export function resolveReplyRecipient(input: {
  actorUserId: string;
  postAuthorId: string;
  replyToUserId: string | null;
}): string | null {
  const recipientUserId = input.replyToUserId ?? input.postAuthorId;
  return recipientUserId === input.actorUserId ? null : recipientUserId;
}

export function truncateActivityPreview(value: string, length = 120): string {
  const clean = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(clean);
  return characters.length > length ? `${characters.slice(0, length).join("")}…` : clean;
}

export function replyTargetHref(postId: string, replyId: string): string {
  return `/posts/${encodeURIComponent(postId)}#reply-${encodeURIComponent(replyId)}`;
}

export function validateSubmissionKey(value: string): string {
  const key = value.trim().toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    throw new Error("回复提交标识无效，请刷新页面后重试");
  }
  return key;
}
