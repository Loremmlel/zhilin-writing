export type NotificationTargetState =
  | "AVAILABLE"
  | "DELETED_BY_AUTHOR"
  | "HIDDEN_BY_ADMIN"
  | "NOT_IN_CURRENT_REVISION"
  | "POST_UNAVAILABLE"
  | "NOT_FOUND";

export type NotificationTargetKind = "POST_REPLY" | "ANNOTATION" | "ANNOTATION_REPLY";

export type NotificationTargetResolution = {
  kind: NotificationTargetKind;
  state: NotificationTargetState;
};

export function resolveNotificationTarget(input: {
  kind: NotificationTargetKind;
  postExists: boolean;
  postReachable: boolean;
  targetState: "normal" | "deleted" | "hidden" | null;
  annotationCurrent?: boolean;
}): NotificationTargetResolution {
  if (!input.postExists || input.targetState === null)
    return { kind: input.kind, state: "NOT_FOUND" };
  if (input.targetState === "hidden") return { kind: input.kind, state: "HIDDEN_BY_ADMIN" };
  if (input.targetState === "deleted") return { kind: input.kind, state: "DELETED_BY_AUTHOR" };
  if (input.kind !== "POST_REPLY" && !input.annotationCurrent)
    return { kind: input.kind, state: "NOT_IN_CURRENT_REVISION" };
  if (!input.postReachable) return { kind: input.kind, state: "POST_UNAVAILABLE" };
  return { kind: input.kind, state: "AVAILABLE" };
}

export function notificationTargetNotice(
  state: Exclude<NotificationTargetState, "AVAILABLE">,
  kind: NotificationTargetKind,
): string {
  const noun = kind === "ANNOTATION" ? "批注" : "回复";
  if (state === "DELETED_BY_AUTHOR") return `该${noun}已被作者删除。`;
  if (state === "HIDDEN_BY_ADMIN") return `该${noun}已被管理员隐藏。`;
  if (state === "NOT_IN_CURRENT_REVISION")
    return "该内容存在于历史版本中，但当前版本已不再包含它。";
  if (state === "POST_UNAVAILABLE") return "关联帖子当前不可用。";
  return "没有找到这条通知关联的内容。";
}

export function notificationNoticeCode(
  state: Exclude<NotificationTargetState, "AVAILABLE">,
  kind: NotificationTargetKind,
): string {
  return `${kind.toLocaleLowerCase("en-US").replaceAll("_", "-")}-${state.toLocaleLowerCase("en-US").replaceAll("_", "-")}`;
}

export function targetHrefWithNotice(
  href: string,
  state: Exclude<NotificationTargetState, "AVAILABLE">,
): string {
  const [path, fragment] = href.split("#", 2);
  const separator = path.includes("?") ? "&" : "?";
  const notice = state.toLocaleLowerCase("en-US").replaceAll("_", "-");
  return `${path}${separator}notice=${notice}${fragment ? `#${fragment}` : ""}`;
}

export function parseNotificationTargetState(
  value: string | undefined,
): Exclude<NotificationTargetState, "AVAILABLE"> | null {
  const normalized = value?.toLocaleUpperCase("en-US").replaceAll("-", "_");
  return normalized === "DELETED_BY_AUTHOR" ||
    normalized === "HIDDEN_BY_ADMIN" ||
    normalized === "NOT_IN_CURRENT_REVISION" ||
    normalized === "POST_UNAVAILABLE" ||
    normalized === "NOT_FOUND"
    ? normalized
    : null;
}
