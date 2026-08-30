import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function runMigration(db: DatabaseSync, filename: string) {
  const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

async function findMigration(prefix: string) {
  const files = await readdir(new URL("../drizzle/", import.meta.url));
  const filename = files.find((name) => name.startsWith(prefix) && name.endsWith(".sql"));
  assert.ok(filename, `${prefix} migration must exist`);
  return filename;
}

async function createMigratedV5Database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const prefix of ["0000_", "0001_", "0002_", "0003_", "0004_"]) {
    await runMigration(db, await findMigration(prefix));
  }

  for (const [id, name] of [["importer", "导入者"], ["native-author", "原生作者"], ["attributed", "关联用户"]]) {
    db.prepare("INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)")
      .run(id, `${id}@example.com`, name, 100, 100);
  }
  db.prepare("INSERT INTO posts (id, author_id, title, markdown, search_text, current_revision_id, published_at, edited_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("post-1", "importer", "迁移前标题", "迁移前正文", "迁移前正文", null, 200, 250, 300);
  db.prepare("INSERT INTO post_revisions (id, post_id, revision_number, kind, title, markdown, created_at, created_by_user_id, restore_source_revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("revision-1", "post-1", 1, "ANNOTATION_STATE", "迁移前标题", "迁移前正文", 300, "importer", null);
  db.prepare("UPDATE posts SET current_revision_id = ? WHERE id = ?").run("revision-1", "post-1");
  db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id, hidden_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("annotation-native", "post-1", "native-author", "原生批注", "迁移前", 310, "revision-1", "native-root-key", 320, "native-author", 330, "importer", "保留原因");
  db.prepare("INSERT INTO annotation_replies (id, annotation_id, author_id, reply_to_user_id, reply_to_reply_id, content_markdown, submission_key, created_at, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id, hidden_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("reply-native", "annotation-native", "importer", "native-author", null, "原生回复", "native-reply-key", 340, 350, "importer", 360, "importer", "回复原因");
  db.prepare("INSERT INTO post_annotation_anchors (post_id, annotation_id) VALUES (?, ?)")
    .run("post-1", "annotation-native");
  db.prepare("INSERT INTO revision_annotation_states (revision_id, annotation_id, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run("revision-1", "annotation-native", 320, "native-author", 330, "importer");
  db.prepare("INSERT INTO activity_events (id, actor_user_id, event_type, post_id, annotation_id, annotation_reply_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("event-1", "importer", "ANNOTATION_REPLY_CREATED", "post-1", "annotation-native", "reply-native", "{\"before\":true}", 370);
  db.prepare("INSERT INTO notifications (id, recipient_user_id, actor_user_id, event_id, notification_type, post_id, annotation_id, annotation_reply_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("notification-native", "native-author", "importer", "event-1", "ANNOTATION_REPLY_RECEIVED", "post-1", "annotation-native", "reply-native", 380, 390);

  db.exec("BEGIN");
  try {
    await runMigration(db, await findMigration("0005_"));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return db;
}

function insertBatch(db: DatabaseSync) {
  db.prepare("INSERT INTO import_batches (id, importer_user_id, source_filename, source_sha256, post_id, revision_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("batch-1", "importer", "文章.docx", "a".repeat(64), "post-1", "revision-1", 400);
}

function insertImportedThread(db: DatabaseSync) {
  db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, source_type, source_author_name, source_initials, source_created_at, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id, attributed_user_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'DOCX_IMPORT', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("annotation-imported", "post-1", "Word 批注", "正文", 400, "revision-1", "docx:batch-1:10", "林柚子", "LYZ", 150, "10", 0, 1, "batch-1", "importer", "attributed");
  db.prepare("INSERT INTO annotation_replies (id, annotation_id, author_id, reply_to_user_id, reply_to_reply_id, content_markdown, submission_key, created_at, source_type, source_author_name, source_initials, source_created_at, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id, attributed_user_id) VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, 'DOCX_IMPORT', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("reply-imported", "annotation-imported", "Word 回复", "docx:batch-1:11", 400, "姬瑕", "JX", 160, "11", 1, 0, "batch-1", "importer", null);
}

test("V5.5 migration preserves native annotation history and lifecycle state", async () => {
  const db = await createMigratedV5Database();
  try {
    assert.deepEqual({ ...db.prepare("SELECT author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id, hidden_reason, source_type, import_batch_id FROM annotations WHERE id = 'annotation-native'").get() }, {
      author_id: "native-author",
      content_markdown: "原生批注",
      original_selected_text: "迁移前",
      created_at: 310,
      created_on_revision_id: "revision-1",
      submission_key: "native-root-key",
      deleted_at: 320,
      deleted_by_user_id: "native-author",
      hidden_at: 330,
      hidden_by_user_id: "importer",
      hidden_reason: "保留原因",
      source_type: "NATIVE",
      import_batch_id: null,
    });
    assert.deepEqual({ ...db.prepare("SELECT author_id, reply_to_user_id, reply_to_reply_id, content_markdown, submission_key, created_at, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id, hidden_reason, source_type FROM annotation_replies WHERE id = 'reply-native'").get() }, {
      author_id: "importer",
      reply_to_user_id: "native-author",
      reply_to_reply_id: null,
      content_markdown: "原生回复",
      submission_key: "native-reply-key",
      created_at: 340,
      deleted_at: 350,
      deleted_by_user_id: "importer",
      hidden_at: 360,
      hidden_by_user_id: "importer",
      hidden_reason: "回复原因",
      source_type: "NATIVE",
    });
    assert.deepEqual({ ...db.prepare("SELECT deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id FROM revision_annotation_states WHERE revision_id = 'revision-1' AND annotation_id = 'annotation-native'").get() }, {
      deleted_at: 320,
      deleted_by_user_id: "native-author",
      hidden_at: 330,
      hidden_by_user_id: "importer",
    });
    assert.deepEqual({ ...db.prepare("SELECT notification_type, annotation_id, annotation_reply_id, read_at, metadata_json, import_batch_id FROM notifications WHERE id = 'notification-native'").get() }, {
      notification_type: "ANNOTATION_REPLY_RECEIVED",
      annotation_id: "annotation-native",
      annotation_reply_id: "reply-native",
      read_at: 390,
      metadata_json: null,
      import_batch_id: null,
    });
    assert.deepEqual({ ...db.prepare("SELECT annotation_id, annotation_reply_id FROM activity_events WHERE id = 'event-1'").get() }, {
      annotation_id: "annotation-native",
      annotation_reply_id: "reply-native",
    });
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("imported roots and replies require source identity and never a native author", async () => {
  const db = await createMigratedV5Database();
  try {
    insertBatch(db);
    insertImportedThread(db);
    assert.deepEqual({ ...db.prepare("SELECT author_id, source_type, source_author_name, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id, attributed_user_id FROM annotations WHERE id = 'annotation-imported'").get() }, {
      author_id: null,
      source_type: "DOCX_IMPORT",
      source_author_name: "林柚子",
      source_comment_id: "10",
      source_document_order: 0,
      source_resolved: 1,
      import_batch_id: "batch-1",
      imported_by_user_id: "importer",
      attributed_user_id: "attributed",
    });
    assert.throws(() => db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, source_type, source_author_name, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DOCX_IMPORT', ?, ?, ?, ?, ?, ?)")
      .run("forged-import", "post-1", "native-author", "伪造", "正文", 401, "revision-1", "docx:batch-1:12", "伪造者", "12", 2, 0, "batch-1", "importer"));
    assert.throws(() => db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, source_type) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'NATIVE')")
      .run("authorless-native", "post-1", "伪造", "正文", 401, "revision-1", "native-without-author"));
    assert.throws(() => db.prepare("INSERT INTO annotation_replies (id, annotation_id, author_id, content_markdown, submission_key, created_at, source_type, source_author_name, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id) VALUES (?, ?, NULL, ?, ?, ?, 'DOCX_IMPORT', ?, ?, ?, ?, ?, ?)")
      .run("wrong-key", "annotation-imported", "错误键", "random-key", 401, "Word", "12", 2, 0, "batch-1", "importer"));
    assert.throws(() => db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, source_type, source_author_name, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'DOCX_IMPORT', ?, ?, NULL, ?, ?, ?)")
      .run("missing-order", "post-1", "缺少顺序", "正文", 401, "revision-1", "docx:batch-1:13", "Word", "13", 0, "batch-1", "importer"));
    assert.throws(() => db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, source_type, source_author_name, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'DOCX_IMPORT', ?, ?, ?, NULL, ?, ?)")
      .run("missing-resolved", "post-1", "缺少状态", "正文", 401, "revision-1", "docx:batch-1:14", "Word", "14", 3, "batch-1", "importer"));
  } finally {
    db.close();
  }
});

test("revision snapshots retain imported reply visibility state", async () => {
  const db = await createMigratedV5Database();
  try {
    insertBatch(db);
    insertImportedThread(db);
    db.prepare("INSERT INTO revision_imported_reply_states (revision_id, annotation_reply_id, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run("revision-1", "reply-imported", 410, "importer", 420, "importer");
    assert.deepEqual({ ...db.prepare("SELECT deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id FROM revision_imported_reply_states WHERE revision_id = 'revision-1' AND annotation_reply_id = 'reply-imported'").get() }, {
      deleted_at: 410,
      deleted_by_user_id: "importer",
      hidden_at: 420,
      hidden_by_user_id: "importer",
    });
  } finally {
    db.close();
  }
});

test("attribution notices are unique per recipient and import batch", async () => {
  const db = await createMigratedV5Database();
  try {
    insertBatch(db);
    db.prepare("INSERT INTO activity_events (id, actor_user_id, event_type, post_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("event-2", "importer", "POST_CREATED", "post-1", 401);
    db.prepare("INSERT INTO notifications (id, recipient_user_id, actor_user_id, event_id, notification_type, post_id, metadata_json, import_batch_id, created_at) VALUES (?, ?, ?, ?, 'DOCX_ATTRIBUTION_NOTICE', ?, ?, ?, ?)")
      .run("notice-1", "attributed", "importer", "event-1", "post-1", "{\"commentCount\":2}", "batch-1", 402);
    assert.throws(() => db.prepare("INSERT INTO notifications (id, recipient_user_id, actor_user_id, event_id, notification_type, post_id, metadata_json, import_batch_id, created_at) VALUES (?, ?, ?, ?, 'DOCX_ATTRIBUTION_NOTICE', ?, ?, ?, ?)")
      .run("notice-2", "attributed", "importer", "event-2", "post-1", "{\"commentCount\":2}", "batch-1", 403));
    assert.throws(() => db.prepare("INSERT INTO notifications (id, recipient_user_id, actor_user_id, event_id, notification_type, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("unknown-notice", "attributed", "importer", "event-2", "UNKNOWN_NOTICE", "post-1", 404));
  } finally {
    db.close();
  }
});

test("import batches require a lowercase hexadecimal SHA-256", async () => {
  const db = await createMigratedV5Database();
  try {
    assert.throws(() => db.prepare("INSERT INTO import_batches (id, importer_user_id, source_filename, source_sha256, post_id, revision_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("batch-invalid", "importer", "文章.docx", "g".repeat(64), "post-1", "revision-1", 400));
    assert.throws(() => db.prepare("INSERT INTO import_batches (id, importer_user_id, source_filename, source_sha256, post_id, revision_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("batch-uppercase", "importer", "文章.docx", "A".repeat(64), "post-1", "revision-1", 400));
  } finally {
    db.close();
  }
});
