export type AssetUploadValidationCode = "UNSUPPORTED_TYPE" | "SIZE_LIMIT";

export type AssetUploadValidationFailure = {
  code: AssetUploadValidationCode;
  message: string;
};

const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function validateAssetUpload(file: {
  size: number;
  mimeType: string;
}): AssetUploadValidationFailure | null {
  const mimeType = file.mimeType.toLocaleLowerCase("en-US");
  if (file.size <= 0) return { code: "SIZE_LIMIT", message: "文件不能为空" };
  if (file.size > 20 * 1024 * 1024) return { code: "SIZE_LIMIT", message: "文件不能超过 20 MB" };
  if (mimeType.startsWith("image/") && !supportedImageTypes.has(mimeType)) {
    return {
      code: "UNSUPPORTED_TYPE",
      message: "暂不支持此图片格式，请使用 PNG、JPEG、GIF 或 WebP",
    };
  }
  if (mimeType.startsWith("image/") && file.size > 10 * 1024 * 1024) {
    return { code: "SIZE_LIMIT", message: "图片不能超过 10 MB" };
  }
  return null;
}
