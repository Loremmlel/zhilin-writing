export type ActionAccessErrorCode = "AUTH_EXPIRED" | "ACCESS_REVOKED" | "ONBOARDING_REQUIRED" | "ADMIN_REQUIRED";

const accessMessages: Record<ActionAccessErrorCode, string> = {
  AUTH_EXPIRED: "登录状态已失效，请重新登录后继续。",
  ACCESS_REVOKED: "你的站点访问权限已被移除。",
  ONBOARDING_REQUIRED: "请先完成站内资料设置后继续。",
  ADMIN_REQUIRED: "你没有执行此管理操作的权限。",
};

export function accessErrorMessage(code: ActionAccessErrorCode): string {
  return accessMessages[code];
}

export function actionAccessFailure(code: ActionAccessErrorCode): { error: string; code: ActionAccessErrorCode } {
  return { error: accessErrorMessage(code), code };
}

export function isBlockingAccessError(code: string | undefined): boolean {
  return code === "ACCESS_REVOKED";
}
