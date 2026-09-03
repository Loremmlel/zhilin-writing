import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../drizzle/0004_far_alex_wilder.sql", import.meta.url),
  "utf8",
);

test("V5 migration creates annotation roots, replies, current anchors, and revision states", () => {
  for (const table of [
    "annotations",
    "annotation_replies",
    "post_annotation_anchors",
    "revision_annotation_states",
  ]) {
    assert.ok(migration.includes("CREATE TABLE `" + table + "`"));
  }
  assert.match(migration, /original_selected_text/);
  assert.match(migration, /created_on_revision_id/);
  assert.match(migration, /submission_key/);
  assert.match(migration, /ALTER TABLE `post_revisions` ADD `kind`/);
  assert.match(migration, /ALTER TABLE `activity_events` ADD `annotation_id`/);
  assert.match(migration, /ALTER TABLE `notifications` ADD `annotation_reply_id`/);
});

test("annotation retry keys and snapshot relations are constrained", () => {
  assert.match(migration, /annotations_author_submission_unique/);
  assert.match(migration, /annotation_replies_author_submission_unique/);
  assert.match(migration, /PRIMARY KEY\(`revision_id`, `annotation_id`\)/);
  assert.match(migration, /PRIMARY KEY\(`post_id`, `annotation_id`\)/);
});
