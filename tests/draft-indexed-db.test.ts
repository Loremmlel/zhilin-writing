import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import "fake-indexeddb/auto";

import { draftKey } from "../lib/domain/rules.ts";
import { loadDraft, type LocalDraft } from "../lib/drafts/indexed-db.ts";
import {
  IMPORT_PREVIEW_STORE_NAME,
  LOCAL_DB_NAME,
  LOCAL_DB_VERSION,
} from "../lib/indexed-db.ts";

beforeEach(deleteLocalDatabase);
afterEach(deleteLocalDatabase);

test("upgrades the version-1 draft database without losing an existing draft", async () => {
  const draft: LocalDraft = {
    title: "Draft",
    markdown: "Body",
    tags: "tag",
    attachmentIds: [],
    baseRevisionId: null,
    updatedAt: 1,
  };
  const oldDb = await openVersionOneDatabase();
  await putOldDraft(oldDb, draftKey("user-1", "post-1"), draft);
  oldDb.close();

  assert.deepEqual(await loadDraft("user-1", "post-1"), draft);
  const upgraded = await openCurrentDatabase();
  assert.equal(upgraded.version, LOCAL_DB_VERSION);
  assert.equal(upgraded.objectStoreNames.contains("drafts"), true);
  assert.equal(upgraded.objectStoreNames.contains(IMPORT_PREVIEW_STORE_NAME), true);
  upgraded.close();
});

function openVersionOneDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open old database"));
  });
}

function putOldDraft(db: IDBDatabase, key: string, draft: LocalDraft): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    tx.objectStore("drafts").put(draft, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("failed to seed old draft"));
    tx.onabort = () => reject(tx.error ?? new Error("failed to seed old draft"));
  });
}

function openCurrentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open current database"));
  });
}

function deleteLocalDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to delete test database"));
    request.onblocked = () => reject(new Error("test database deletion was blocked"));
  });
}
