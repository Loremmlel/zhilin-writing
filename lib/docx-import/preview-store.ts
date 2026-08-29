import {
  IMPORT_PREVIEW_EXPIRY_INDEX,
  IMPORT_PREVIEW_STORE_NAME,
  openLocalDatabase,
  withLocalStore,
} from "../indexed-db.ts";
import type { DocxPreviewRecord } from "./types.ts";

export async function saveImportPreview(preview: DocxPreviewRecord): Promise<void> {
  await withLocalStore<IDBValidKey>(
    IMPORT_PREVIEW_STORE_NAME,
    "readwrite",
    (store) => store.put(preview),
  );
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
    const index = tx.objectStore(IMPORT_PREVIEW_STORE_NAME).index(IMPORT_PREVIEW_EXPIRY_INDEX);
    const request = index.openCursor(IDBKeyRange.upperBound(new Date(now).toISOString()));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      removed += 1;
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
