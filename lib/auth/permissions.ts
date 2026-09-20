export const permissionGroupLabels = { normal: "普通组", game: "游戏组" } as const;
export type PermissionGroup = keyof typeof permissionGroupLabels;

export function isPermissionGroup(value: unknown): value is PermissionGroup {
  return value === "normal" || value === "game";
}

export function canAccessWriting(allowed: { isAdmin: boolean; permissionGroup: string }) {
  return allowed.isAdmin || allowed.permissionGroup === "normal";
}
