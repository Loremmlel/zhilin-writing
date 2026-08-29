import { draftKey } from "../domain/rules.ts";
import { DRAFT_STORE_NAME, withLocalStore } from "../indexed-db.ts";

export type LocalDraft = {
  title: string;
  markdown: string;
  tags: string;
  attachmentIds: string[];
  attachments?: Array<{
    id: string;
    filename: string;
    kind: "image" | "attachment";
    url: string;
    markdown: string;
  }>;
  baseRevisionId: string | null;
  updatedAt: number;
};

export async function loadDraft(userId: string, postId: string): Promise<LocalDraft | null> {
  const value = await withLocalStore<LocalDraft | undefined>(
    DRAFT_STORE_NAME,
    "readonly",
    (store) => store.get(draftKey(userId, postId)),
  );
  return value ?? null;
}

export async function saveDraft(userId: string, postId: string, draft: LocalDraft): Promise<void> {
  await withLocalStore<IDBValidKey>(
    DRAFT_STORE_NAME,
    "readwrite",
    (store) => store.put(draft, draftKey(userId, postId)),
  );
}

export async function removeDraft(userId: string, postId: string): Promise<void> {
  await withLocalStore<undefined>(
    DRAFT_STORE_NAME,
    "readwrite",
    (store) => store.delete(draftKey(userId, postId)),
  );
}
