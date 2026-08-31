export function isAttachmentAssetHref(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("/api/assets/");
}
