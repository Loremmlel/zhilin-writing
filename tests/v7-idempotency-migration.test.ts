import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function applyMigration(db: DatabaseSync, filename: string) {
  const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
}

test("V7 adds a nullable per-author post creation idempotency key", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const files = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const migration = files.find((name) => name.startsWith("0007_"));
  assert.ok(migration, "V7 idempotency migration must exist");
  for (const filename of files.filter((name) => name < migration)) await applyMigration(db, filename);

  db.prepare("INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)")
    .run("author-a", "a@example.com", "作者甲", 1, 1);
  db.prepare("INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)")
    .run("author-b", "b@example.com", "作者乙", 1, 1);
  db.prepare("INSERT INTO posts (id, author_id, title, markdown, search_text, published_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("legacy", "author-a", "旧帖", "正文", "正文", 2, 2);

  await applyMigration(db, migration);
  assert.equal(db.prepare("SELECT creation_submission_key FROM posts WHERE id = 'legacy'").get()?.creation_submission_key, null);

  const insert = db.prepare("INSERT INTO posts (id, author_id, creation_submission_key, title, markdown, search_text, published_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("a-1", "author-a", "00112233-4455-4677-8899-aabbccddeeff", "一", "正文", "正文", 3, 3);
  assert.throws(() => insert.run("a-2", "author-a", "00112233-4455-4677-8899-aabbccddeeff", "二", "正文", "正文", 4, 4));
  insert.run("b-1", "author-b", "00112233-4455-4677-8899-aabbccddeeff", "三", "正文", "正文", 5, 5);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("new-post retries query the same server key before and after a unique race", async () => {
  const [service, action, editor] = await Promise.all([
    readFile(new URL("../lib/posts/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(site)/posts/new/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/editor/post-editor-form.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal((service.match(/findPostByCreationSubmissionKey\(authorId, submissionKey\)/g) ?? []).length, 2);
  assert.match(action, /submissionKey: String\(formData\.get\("creationSubmissionKey"\)/);
  assert.match(editor, /creationSubmissionKey/);
  assert.match(editor, /draft\.creationSubmissionKey/);
});
