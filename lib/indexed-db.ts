export const LOCAL_DB_NAME = "zhilin-writing";
export const LOCAL_DB_VERSION = 2;
export const DRAFT_STORE_NAME = "drafts";
export const IMPORT_PREVIEW_STORE_NAME = "docx-import-previews";
export const IMPORT_PREVIEW_EXPIRY_INDEX = "expiresAt";

export function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        db.createObjectStore(DRAFT_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(IMPORT_PREVIEW_STORE_NAME)) {
        const previews = db.createObjectStore(IMPORT_PREVIEW_STORE_NAME, { keyPath: "importBatchId" });
        previews.createIndex(IMPORT_PREVIEW_EXPIRY_INDEX, "expiresAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地数据"));
  });
}

export async function withLocalStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    let result: T;
    const tx = db.transaction(storeName, mode);
    let request: IDBRequest<T>;
    try {
      request = run(tx.objectStore(storeName));
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error("本地数据操作失败"));
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("本地数据操作失败"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("本地数据操作已取消"));
    };
  });
}
