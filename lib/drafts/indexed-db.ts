import { draftKey } from "@/lib/domain/rules";

export type LocalDraft = {
  title: string;
  markdown: string;
  tags: string;
  assetIds: string[];
  updatedAt: number;
};

const DB_NAME = "zhilin-writing";
const STORE_NAME = "drafts";

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地草稿"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地草稿操作失败"));
    tx.oncomplete = () => db.close();
  });
}

export async function loadDraft(userId: string, postId: string): Promise<LocalDraft | null> {
  const value = await withStore<LocalDraft | undefined>("readonly", (store) => store.get(draftKey(userId, postId)));
  return value ?? null;
}

export async function saveDraft(userId: string, postId: string, draft: LocalDraft): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(draft, draftKey(userId, postId)));
}

export async function removeDraft(userId: string, postId: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(draftKey(userId, postId)));
}
