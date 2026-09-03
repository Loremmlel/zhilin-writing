import { BrowserAssetUploadError, type AssetUploadErrorCode } from "./errors.ts";
import { validateAssetUpload } from "./upload-policy.ts";

export type BrowserAssetUploadResult = {
  asset?: {
    id: string;
    filename: string;
    kind: "image" | "attachment";
    url: string;
  };
  markdown?: string;
  error?: string;
  code?: AssetUploadErrorCode;
};

export function createSerialUploadQueue() {
  let tail = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function uploadAsset(file: File, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<BrowserAssetUploadResult & { asset: NonNullable<BrowserAssetUploadResult["asset"]> }> {
  return new Promise((resolve, reject) => {
    const validation = validateAssetUpload({ size: file.size, mimeType: file.type || "application/octet-stream" });
    if (validation) {
      reject(new BrowserAssetUploadError(validation.code, validation.message));
      return;
    }
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.set("file", file);

    if (signal?.aborted) {
      reject(new DOMException("上传已取消", "AbortError"));
      return;
    }
    const stopListening = () => signal?.removeEventListener("abort", abortRequest);
    const abortRequest = () => request.abort();
    signal?.addEventListener("abort", abortRequest, { once: true });
    request.open("POST", "/api/assets");
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      stopListening();
      const data = (request.response ?? {}) as BrowserAssetUploadResult;
      if (request.status < 200 || request.status >= 300 || !data.asset) {
        reject(new BrowserAssetUploadError(data.code ?? "SERVER_FAILURE", data.error ?? "文件上传失败，请稍后重试"));
        return;
      }
      resolve({ ...data, asset: data.asset });
    });
    request.addEventListener("error", () => {
      stopListening();
      reject(new BrowserAssetUploadError("NETWORK_FAILURE", "网络连接中断，上传失败"));
    });
    request.addEventListener("abort", () => {
      stopListening();
      reject(new DOMException("上传已取消", "AbortError"));
    });
    onProgress(0);
    request.send(formData);
  });
}
