import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const filename of files) {
    const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

function plan(db: DatabaseSync, sql: string, ...params: Array<string | number | null>): string {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail)).join("\n");
}

test("V7 indexes serve the existing list, notification, activity, revision, and annotation queries", async () => {
  const db = await migratedDatabase();
  const cases: Array<[string, string, Array<string | number | null>, string]> = [
    ["latest", "SELECT id FROM posts WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY published_at DESC LIMIT 40", [], "posts_published_at_idx"],
    ["active", "SELECT id FROM posts WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY last_activity_at DESC LIMIT 40", [], "posts_last_activity_at_idx"],
    ["profile posts", "SELECT id FROM posts WHERE author_id = ? AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY published_at DESC LIMIT 40", ["user"], "posts_author_published_idx"],
    ["post replies", "SELECT id FROM replies WHERE post_id = ? ORDER BY published_at", ["post"], "replies_post_published_idx"],
    ["tag posts", "SELECT post_tags.post_id FROM post_tags INNER JOIN tags ON post_tags.tag_id = tags.id WHERE tags.normalized_name = ?", ["校园"], "post_tags_tag_post_idx"],
    ["activity", "SELECT id FROM activity_events WHERE actor_user_id = ? AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 50", ["user"], "activity_events_actor_created_idx"],
    ["notifications", "SELECT id FROM notifications WHERE recipient_user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 60", ["user"], "notifications_recipient_read_created_idx"],
    ["annotation roots", "SELECT id FROM annotations WHERE post_id = ? ORDER BY created_at", ["post"], "annotations_post_created_idx"],
    ["annotation replies", "SELECT id FROM annotation_replies WHERE annotation_id = ? ORDER BY created_at", ["annotation"], "annotation_replies_annotation_created_idx"],
    ["revisions", "SELECT id FROM post_revisions WHERE post_id = ? ORDER BY revision_number DESC", ["post"], "post_revisions_post_number_unique"],
  ];

  for (const [label, sql, params, index] of cases) {
    assert.match(plan(db, sql, ...params), new RegExp(index), `${label} must use ${index}`);
  }
  db.close();
});

test("list queries batch related rows instead of querying once per rendered item", async () => {
  const source = await readFile(new URL("../db/queries.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /rows\.map\(async \(row\) => \(\{[\s\S]{0,180}getTagsForPost/);
  assert.doesNotMatch(source, /rows\.map\(async \(tag\)/);
  assert.match(source, /inArray\(postTags\.postId, ids\)/);
  assert.match(source, /groupBy\(replies\.postId\)/);
  assert.match(source, /replyToById/);
  assert.match(source, /loadLifecycleQueryContext/);
});
