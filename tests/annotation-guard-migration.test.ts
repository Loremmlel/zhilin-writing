import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function createV5Database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const files = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  assert.ok(
    files.some((name) => name.startsWith("0006_")),
    "0006 AnnotationGuard migration must exist",
  );
  for (const filename of files.filter((name) => name < "0006_")) {
    const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean))
      db.exec(statement);
  }
  return db;
}

async function applyV6Migration(db: DatabaseSync) {
  const files = await readdir(new URL("../drizzle/", import.meta.url));
  const filename = files.find((name) => name.startsWith("0006_") && name.endsWith(".sql"));
  assert.ok(filename, "0006 AnnotationGuard migration must exist");
  const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean))
    db.exec(statement);
}

function seedAnnotation(db: DatabaseSync) {
  db.prepare(
    "INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
  ).run("author", "author@example.com", "作者", 100, 100);
  db.prepare(
    "INSERT INTO posts (id, author_id, title, markdown, search_text, current_revision_id, published_at, edited_at, last_activity_at) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?)",
  ).run("post", "author", "标题", "正文", "正文", 200, 200);
  db.prepare(
    "INSERT INTO post_revisions (id, post_id, revision_number, kind, title, markdown, created_at, created_by_user_id, restore_source_revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
  ).run("revision", "post", 1, "CONTENT_EDIT", "标题", "正文", 200, "author");
  db.prepare("UPDATE posts SET current_revision_id = ? WHERE id = ?").run("revision", "post");
  db.prepare(
    "INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("annotation", "post", "author", "批注", "正文", 210, "revision", "submission");
}

test("V6 migration adds nullable anchor-retirement lifecycle without changing existing annotations", async () => {
  const db = await createV5Database();
  try {
    seedAnnotation(db);
    db.prepare("INSERT INTO post_annotation_anchors (post_id, annotation_id) VALUES (?, ?)").run(
      "post",
      "annotation",
    );
    await applyV6Migration(db);
    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT anchor_retired_at, anchor_retired_by_user_id, anchor_retired_reason, deleted_at FROM annotations WHERE id = ?",
          )
          .get("annotation"),
      },
      {
        anchor_retired_at: null,
        anchor_retired_by_user_id: null,
        anchor_retired_reason: null,
        deleted_at: null,
      },
    );
    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT post_id, annotation_id FROM post_annotation_anchors WHERE annotation_id = ?",
          )
          .get("annotation"),
      },
      {
        post_id: "post",
        annotation_id: "annotation",
      },
    );
    db.prepare(
      "UPDATE annotations SET anchor_retired_at = ?, anchor_retired_by_user_id = ?, anchor_retired_reason = ? WHERE id = ?",
    ).run(300, "author", "POST_EDIT", "annotation");
    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT anchor_retired_at, anchor_retired_by_user_id, anchor_retired_reason, deleted_at FROM annotations WHERE id = ?",
          )
          .get("annotation"),
      },
      {
        anchor_retired_at: 300,
        anchor_retired_by_user_id: "author",
        anchor_retired_reason: "POST_EDIT",
        deleted_at: null,
      },
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("V6 migration rejects incomplete or unknown retirement lifecycle", async () => {
  const db = await createV5Database();
  try {
    seedAnnotation(db);
    await applyV6Migration(db);
    assert.throws(() =>
      db
        .prepare("UPDATE annotations SET anchor_retired_reason = ? WHERE id = ?")
        .run("POST_EDIT", "annotation"),
    );
    assert.throws(() =>
      db
        .prepare(
          "UPDATE annotations SET anchor_retired_at = ?, anchor_retired_by_user_id = ?, anchor_retired_reason = ? WHERE id = ?",
        )
        .run(300, "author", "UNKNOWN", "annotation"),
    );
  } finally {
    db.close();
  }
});
