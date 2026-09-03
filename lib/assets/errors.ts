import type { ActionAccessErrorCode } from "@/lib/actions/result";
import type { AssetUploadValidationCode } from "./upload-policy";

export type AssetUploadErrorCode =
  AssetUploadValidationCode | ActionAccessErrorCode | "NETWORK_FAILURE" | "SERVER_FAILURE";

export class AssetStorageError extends Error {
  readonly code: AssetUploadValidationCode | "SERVER_FAILURE";

  constructor(
    code: AssetUploadValidationCode | "SERVER_FAILURE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.name = "AssetStorageError";
  }
}

export class BrowserAssetUploadError extends Error {
  readonly code: AssetUploadErrorCode;

  constructor(code: AssetUploadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BrowserAssetUploadError";
  }
}
