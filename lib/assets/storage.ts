import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { classifyUpload } from "@/lib/domain/rules";
import { AssetStorageError } from "./errors";
import { validateAssetUpload } from "./upload-policy";
import { logServerError } from "@/lib/logging";

function safeFilename(filename: string): string {
  return filename.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100) || "file";
}

export async function storeTemporaryAsset(ownerId: string, file: File, requestedKind?: "avatar") {
  const validation = validateAssetUpload({
    size: file.size,
    mimeType: file.type || "application/octet-stream",
  });
  if (validation) throw new AssetStorageError(validation.code, validation.message);

  const kind = requestedKind ?? classifyUpload(file.type || "application/octet-stream");
  const id = crypto.randomUUID();
  const r2Key = `${ownerId}/${kind}/${id}-${safeFilename(file.name)}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (!env.BUCKET) throw new AssetStorageError("SERVER_FAILURE", "文件存储暂时不可用");
  try {
    await env.BUCKET.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { originalFilename: file.name, ownerId, kind },
    });
  } catch (error) {
    throw new AssetStorageError("SERVER_FAILURE", "文件上传失败，请稍后重试", { cause: error });
  }

  const record = {
    id,
    ownerId,
    postId: null,
    r2Key,
    kind,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    byteSize: file.size,
    status: "temporary" as const,
    createdAt,
    boundAt: null,
    expiresAt,
    deletedAt: null,
  };
  try {
    await getDb().insert(assets).values(record);
  } catch (error) {
    try {
      await env.BUCKET.delete(r2Key);
    } catch (compensationError) {
      // A later orphan scan can recover an object whose metadata insert and compensation both failed.
      logServerError({
        operation: "asset.upload-compensation-delete",
        entityId: id,
        userId: ownerId,
        error: compensationError,
        errorCode: "R2_DELETE_FAILED",
      });
    }
    throw new AssetStorageError("SERVER_FAILURE", "文件记录保存失败，请重试", { cause: error });
  }
  return record;
}

export async function getStoredObject(r2Key: string) {
  if (!env.BUCKET) throw new Error("R2 文件存储尚未连接");
  return env.BUCKET.get(r2Key);
}
