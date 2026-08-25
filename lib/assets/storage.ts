import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { classifyUpload, validateUpload } from "@/lib/domain/rules";

function safeFilename(filename: string): string {
  return filename.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100) || "file";
}

export async function storeTemporaryAsset(ownerId: string, file: File, requestedKind?: "avatar") {
  const error = validateUpload({ size: file.size, mimeType: file.type || "application/octet-stream" });
  if (error) throw new Error(error);

  const kind = requestedKind ?? classifyUpload(file.type || "application/octet-stream");
  const id = crypto.randomUUID();
  const r2Key = `${ownerId}/${kind}/${id}-${safeFilename(file.name)}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (!env.BUCKET) throw new Error("R2 文件存储尚未连接");
  await env.BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { originalFilename: file.name, ownerId, kind },
  });

  const record = {
    id, ownerId, postId: null, r2Key, kind,
    filename: file.name, mimeType: file.type || "application/octet-stream",
    byteSize: file.size, status: "temporary" as const, createdAt,
    boundAt: null, expiresAt, deletedAt: null,
  };
  await getDb().insert(assets).values(record);
  return record;
}

export async function getStoredObject(r2Key: string) {
  if (!env.BUCKET) throw new Error("R2 文件存储尚未连接");
  return env.BUCKET.get(r2Key);
}
