import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function runMigration(db: DatabaseSync, filename: string) {
  const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
}

test("V3 migration backfills one initial revision and preserves existing asset references", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  await runMigration(db, "0000_fine_whirlwind.sql");
  await runMigration(db, "0001_optimal_taskmaster.sql");

  db.prepare(
    "INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
  ).run("user-1", "member@example.com", "成员", 100, 100);
  db.prepare(
    "INSERT INTO posts (id, author_id, title, markdown, search_text, published_at, edited_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("post-1", "user-1", "旧标题", "![旧图](/api/assets/image-a)", "旧图", 200, null, 200);
  db.prepare(
    "INSERT INTO assets (id, owner_id, post_id, r2_key, kind, filename, mime_type, byte_size, status, created_at, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'permanent', ?, ?)",
  ).run("image-a", "user-1", "post-1", "image-a", "image", "a.png", "image/png", 10, 190, 200);
  db.prepare(
    "INSERT INTO assets (id, owner_id, post_id, r2_key, kind, filename, mime_type, byte_size, status, created_at, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'permanent', ?, ?)",
  ).run(
    "file-b",
    "user-1",
    "post-1",
    "file-b",
    "attachment",
    "b.docx",
    "application/docx",
    20,
    190,
    200,
  );

  const files = await readdir(new URL("../drizzle/", import.meta.url));
  const v3 = files.find((name) => name.startsWith("0002_") && name.endsWith(".sql"));
  assert.ok(v3, "V3 migration must exist");
  await runMigration(db, v3);

  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT current_revision_id, title, markdown, edited_at, last_activity_at FROM posts WHERE id = 'post-1'",
        )
        .get(),
    },
    {
      current_revision_id: "revision:post-1:1",
      title: "旧标题",
      markdown: "![旧图](/api/assets/image-a)",
      edited_at: null,
      last_activity_at: 200,
    },
  );
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT id, post_id, revision_number, title, markdown, created_by_user_id, restore_source_revision_id FROM post_revisions",
        )
        .get(),
    },
    {
      id: "revision:post-1:1",
      post_id: "post-1",
      revision_number: 1,
      title: "旧标题",
      markdown: "![旧图](/api/assets/image-a)",
      created_by_user_id: "user-1",
      restore_source_revision_id: null,
    },
  );
  assert.deepEqual(
    db
      .prepare("SELECT asset_id, usage FROM post_asset_refs ORDER BY asset_id")
      .all()
      .map((row) => ({ ...row })),
    [
      { asset_id: "file-b", usage: "attachment" },
      { asset_id: "image-a", usage: "inline" },
    ],
  );
  assert.deepEqual(
    db
      .prepare("SELECT asset_id, usage FROM revision_asset_refs ORDER BY asset_id")
      .all()
      .map((row) => ({ ...row })),
    [
      { asset_id: "file-b", usage: "attachment" },
      { asset_id: "image-a", usage: "inline" },
    ],
  );
});
