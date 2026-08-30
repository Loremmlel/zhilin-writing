import {
  IMPORT_PREVIEW_STORE_NAME,
  openLocalDatabase,
  withLocalStore,
} from "../indexed-db.ts";
import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { DocxImportError, type DocxPreviewRecord } from "./types.ts";

export async function saveImportPreview(
  preview: DocxPreviewRecord,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const persisted = normalizePreview(preview, now);
  assertPersistable(persisted);
  await withLocalStore<IDBValidKey>(
    IMPORT_PREVIEW_STORE_NAME,
    "readwrite",
    (store) => store.put(persisted),
  );
  if (signal?.aborted) {
    await removeImportPreview(persisted.importBatchId);
    signal.throwIfAborted();
  }
}

export async function loadImportPreview(
  importBatchId: string,
  now = Date.now(),
): Promise<DocxPreviewRecord | null> {
  await purgeExpiredImportPreviews(now);
  const preview = await withLocalStore<DocxPreviewRecord | undefined>(
    IMPORT_PREVIEW_STORE_NAME,
    "readonly",
    (store) => store.get(importBatchId),
  );
  return preview ?? null;
}

export async function listImportPreviews(now = Date.now()): Promise<DocxPreviewRecord[]> {
  await purgeExpiredImportPreviews(now);
  const previews = await withLocalStore<DocxPreviewRecord[]>(
    IMPORT_PREVIEW_STORE_NAME,
    "readonly",
    (store) => store.getAll(),
  );
  return previews.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function removeImportPreview(importBatchId: string): Promise<void> {
  await withLocalStore<undefined>(
    IMPORT_PREVIEW_STORE_NAME,
    "readwrite",
    (store) => store.delete(importBatchId),
  );
}

export async function purgeExpiredImportPreviews(now = Date.now()): Promise<number> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    let removed = 0;
    const tx = db.transaction(IMPORT_PREVIEW_STORE_NAME, "readwrite");
    const store = tx.objectStore(IMPORT_PREVIEW_STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const value = cursor.value as Partial<DocxPreviewRecord>;
      const expiry = typeof value.expiresAt === "string"
        ? parseCanonicalTimestamp(value.expiresAt)
        : undefined;
      if (expiry === undefined || expiry <= now) {
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("无法清理过期导入预览"));
    tx.oncomplete = () => {
      db.close();
      resolve(removed);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("无法清理过期导入预览"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("导入预览清理已取消"));
    };
  });
}

function normalizePreview(preview: DocxPreviewRecord, now: number): DocxPreviewRecord {
  const requestedCreatedAt = parseCanonicalTimestamp(preview.createdAt);
  const createdAt = requestedCreatedAt !== undefined && requestedCreatedAt <= now
    ? requestedCreatedAt
    : now;
  return {
    version: 1,
    importBatchId: preview.importBatchId,
    title: preview.title,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + DOCX_IMPORT_LIMITS.previewTtlMs).toISOString(),
    ir: preview.ir,
    canonicalMarkdown: preview.canonicalMarkdown,
    temporaryAssets: preview.temporaryAssets,
    authorMappings: preview.authorMappings,
  };
}

function assertPersistable(preview: DocxPreviewRecord): void {
  for (const asset of preview.ir.assets) {
    if (!(asset.bytes instanceof Uint8Array)) {
      throw new DocxImportError(
        "PREVIEW_DATA_INVALID",
        "DOCX Preview asset bytes must be Uint8Array",
        { assetId: asset.id },
      );
    }
  }
  const withoutAssetBytes = {
    ...preview,
    ir: {
      ...preview.ir,
      assets: preview.ir.assets.map(({ bytes, ...asset }) => {
        void bytes;
        return asset;
      }),
    },
  };
  if (containsBinary(withoutAssetBytes)) {
    throw new DocxImportError(
      "PREVIEW_DATA_INVALID",
      "DOCX Preview contains an unsupported binary value",
    );
  }
}

function parseCanonicalTimestamp(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

function containsBinary(value: unknown, seen = new Set<object>()): boolean {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => containsBinary(item, seen));
}
