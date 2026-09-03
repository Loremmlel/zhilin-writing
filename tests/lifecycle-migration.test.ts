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

test("V4 migration preserves V3 data and backfills direct reply targets", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  await runMigration(db, "0000_fine_whirlwind.sql");
  await runMigration(db, "0001_optimal_taskmaster.sql");
  await runMigration(db, "0002_slimy_marvex.sql");

  for (const [id, name] of [
    ["author", "作者"],
    ["member-b", "乙"],
    ["member-c", "丙"],
  ]) {
    db.prepare(
      "INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
    ).run(id, `${id}@example.com`, name, 100, 100);
  }
  db.prepare(
    "INSERT INTO posts (id, author_id, title, markdown, search_text, current_revision_id, published_at, edited_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("post-1", "author", "标题", "正文", "正文", null, 200, null, 500);
  db.prepare(
    "INSERT INTO replies (id, post_id, author_id, root_reply_id, reply_to_user_id, submission_key, markdown, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("reply-a", "post-1", "author", null, null, "a", "A", 300);
  db.prepare(
    "INSERT INTO replies (id, post_id, author_id, root_reply_id, reply_to_user_id, submission_key, markdown, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("reply-b", "post-1", "member-b", "reply-a", "author", "b", "B", 400);
  db.prepare(
    "INSERT INTO replies (id, post_id, author_id, root_reply_id, reply_to_user_id, submission_key, markdown, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("reply-c", "post-1", "member-c", "reply-a", "member-b", "c", "C", 500);

  const files = await readdir(new URL("../drizzle/", import.meta.url));
  const v4 = files.find((name) => name.startsWith("0003_") && name.endsWith(".sql"));
  assert.ok(v4, "V4 migration must exist");
  await runMigration(db, v4);

  assert.deepEqual(
    db
      .prepare("SELECT id, reply_to_reply_id FROM replies ORDER BY published_at")
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "reply-a", reply_to_reply_id: null },
      { id: "reply-b", reply_to_reply_id: "reply-a" },
      { id: "reply-c", reply_to_reply_id: "reply-b" },
    ],
  );
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT deleted_by_user_id, hidden_by_user_id, hidden_reason FROM posts WHERE id = 'post-1'",
        )
        .get(),
    },
    {
      deleted_by_user_id: null,
      hidden_by_user_id: null,
      hidden_reason: null,
    },
  );
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT deleted_by_user_id, hidden_by_user_id, hidden_reason FROM replies WHERE id = 'reply-a'",
        )
        .get(),
    },
    {
      deleted_by_user_id: null,
      hidden_by_user_id: null,
      hidden_reason: null,
    },
  );

  db.prepare(
    "INSERT INTO admin_audit_log (id, admin_user_id, action_type, target_type, target_id, created_at, metadata_json, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "audit-1",
    "author",
    "POST_HIDDEN",
    "POST",
    "post-1",
    600,
    null,
    "POST_HIDDEN:POST:post-1:active",
  );
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO admin_audit_log (id, admin_user_id, action_type, target_type, target_id, created_at, metadata_json, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "audit-2",
        "author",
        "POST_HIDDEN",
        "POST",
        "post-1",
        601,
        null,
        "POST_HIDDEN:POST:post-1:active",
      ),
  );
});
