import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import * as schema from "../db/schema.ts";
import { planAnnotatedPostSave } from "../lib/annotations/save-plan.ts";
import * as saveTransaction from "../lib/posts/save-transaction.ts";

const AUTHOR = "00000000-0000-4000-8000-000000000001";
const POST = "00000000-0000-4000-8000-000000000002";
const REVISION_1 = "00000000-0000-4000-8000-000000000003";
const REVISION_2 = "00000000-0000-4000-8000-000000000004";
const IMPORT_BATCH = "00000000-0000-4000-8000-000000000005";
const IMPORTED_REPLY = "00000000-0000-4000-8000-000000000006";
const A = "ann_00000000-0000-4000-8000-000000000007";
const B = "ann_00000000-0000-4000-8000-000000000008";
const ORIGINAL_MARKDOWN = `:annotation[原文 A]{#${A}} 与 :annotation[原文 B]{#${B}}`;
const NEXT_MARKDOWN = `保留 :annotation[内部已改 B]{#${B}}`;
const ORIGINAL_TIME = Date.parse("2026-08-31T00:00:00.000Z");
const SAVE_TIME = new Date("2026-08-31T01:00:00.000Z");

type SaveSections = {
  guard?: BatchItem<"sqlite">;
  content: BatchItem<"sqlite">[];
  annotations?: BatchItem<"sqlite">[];
  assets: BatchItem<"sqlite">[];
  tags: BatchItem<"sqlite">[];
};

type BuiltSaveInput = {
  postId: string;
  currentUserId: string;
  revisionId: string;
  revisionNumber: number;
  acceptedBaseRevisionId: string;
  title: string;
  markdown: string;
  now: Date;
  nextAssetRefs: Array<{ assetId: string; usage: "inline" | "attachment" }>;
  annotationPlan: ReturnType<typeof planAnnotatedPostSave>;
  tagOperations: BatchItem<"sqlite">[];
};

function buildOperations(db: unknown, input: BuiltSaveInput): SaveSections {
  const build = (saveTransaction as unknown as {
    buildAnnotatedPostSaveOperations?: (database: unknown, value: BuiltSaveInput) => SaveSections;
  }).buildAnnotatedPostSaveOperations;
  if (typeof build !== "function") assert.fail("production annotated-save operation builder must exist");
  return build(db, input);
}

test("annotated save persists revision membership retirement snapshots and timestamps atomically", async () => {
  const harness = await createHarness();
  try {
    await executeSave(harness.database, REVISION_1);

    assert.deepEqual(row(harness.sqlite, "SELECT title, markdown, current_revision_id, edited_at, last_activity_at FROM posts WHERE id = ?", POST), {
      title: "修改后标题",
      markdown: NEXT_MARKDOWN,
      current_revision_id: REVISION_2,
      edited_at: SAVE_TIME.getTime(),
      last_activity_at: ORIGINAL_TIME,
    });
    assert.equal(count(harness.sqlite, "post_revisions"), 2);
    assert.deepEqual(harness.sqlite.prepare("SELECT annotation_id FROM post_annotation_anchors WHERE post_id = ? ORDER BY annotation_id").all(POST).map((value) => ({ ...value })), [
      { annotation_id: B },
    ]);
    assert.deepEqual(row(harness.sqlite, "SELECT deleted_at, anchor_retired_at, anchor_retired_by_user_id, anchor_retired_reason FROM annotations WHERE id = ?", A), {
      deleted_at: null,
      anchor_retired_at: SAVE_TIME.getTime(),
      anchor_retired_by_user_id: AUTHOR,
      anchor_retired_reason: "POST_EDIT",
    });
    assert.deepEqual(row(harness.sqlite, "SELECT original_selected_text, anchor_retired_at FROM annotations WHERE id = ?", B), {
      original_selected_text: "原文 B",
      anchor_retired_at: null,
    });
    assert.deepEqual(harness.sqlite.prepare("SELECT annotation_id FROM revision_annotation_states WHERE revision_id = ?").all(REVISION_2).map((value) => ({ ...value })), [
      { annotation_id: B },
    ]);
    assert.deepEqual(harness.sqlite.prepare("SELECT annotation_reply_id FROM revision_imported_reply_states WHERE revision_id = ?").all(REVISION_2).map((value) => ({ ...value })), [
      { annotation_reply_id: IMPORTED_REPLY },
    ]);
  } finally {
    harness.sqlite.close();
  }
});

test("a mid-batch failure rolls back every annotated save relation", async () => {
  const harness = await createHarness(5);
  try {
    await assert.rejects(executeSave(harness.database, REVISION_1), /injected batch failure/);
    assert.deepEqual(row(harness.sqlite, "SELECT title, markdown, current_revision_id, edited_at, last_activity_at FROM posts WHERE id = ?", POST), {
      title: "原标题",
      markdown: ORIGINAL_MARKDOWN,
      current_revision_id: REVISION_1,
      edited_at: null,
      last_activity_at: ORIGINAL_TIME,
    });
    assert.equal(count(harness.sqlite, "post_revisions"), 1);
    assert.equal(count(harness.sqlite, "post_annotation_anchors"), 2);
    assert.deepEqual(row(harness.sqlite, "SELECT anchor_retired_at, anchor_retired_reason, original_selected_text FROM annotations WHERE id = ?", A), {
      anchor_retired_at: null,
      anchor_retired_reason: null,
      original_selected_text: "原文 A",
    });
    assert.equal(Number(harness.sqlite.prepare("SELECT COUNT(*) AS value FROM revision_annotation_states WHERE revision_id = ?").get(REVISION_2)?.value), 0);
  } finally {
    harness.sqlite.close();
  }
});

test("a stale CAS base aborts the complete annotated save", async () => {
  const harness = await createHarness();
  try {
    await assert.rejects(executeSave(harness.database, "stale-revision"));
    assert.equal(count(harness.sqlite, "post_revisions"), 1);
    assert.equal(count(harness.sqlite, "post_annotation_anchors"), 2);
    assert.deepEqual(row(harness.sqlite, "SELECT title, current_revision_id FROM posts WHERE id = ?", POST), {
      title: "原标题",
      current_revision_id: REVISION_1,
    });
  } finally {
    harness.sqlite.close();
  }
});

async function executeSave(database: SqliteRemoteDatabase<typeof schema>, acceptedBaseRevisionId: string) {
  const annotationPlan = planAnnotatedPostSave({
    baseIds: [A, B],
    submittedMarkdown: NEXT_MARKDOWN,
    confirmedDeletionIds: [A],
    currentStates: [active(A), active(B)],
    currentImportedReplyStates: [{
      annotationId: B,
      annotationReplyId: IMPORTED_REPLY,
      deletedAt: null,
      deletedByUserId: null,
      hiddenAt: null,
      hiddenByUserId: null,
    }],
    actorUserId: AUTHOR,
    at: SAVE_TIME,
  });
  const sections = buildOperations(database, {
    postId: POST,
    currentUserId: AUTHOR,
    revisionId: REVISION_2,
    revisionNumber: 2,
    acceptedBaseRevisionId,
    title: "修改后标题",
    markdown: NEXT_MARKDOWN,
    now: SAVE_TIME,
    nextAssetRefs: [],
    annotationPlan,
    tagOperations: [database.delete(schema.postTags).where(eq(schema.postTags.postId, POST))],
  });
  await saveTransaction.commitPostSave((items) => database.batch(items as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]), sections);
}

function active(annotationId: string) {
  return { annotationId, deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null };
}

async function createHarness(failAfterStatement?: number) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const filename of migrations) {
    const source = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) sqlite.exec(statement);
  }
  seed(sqlite);

  const execute = async (sql: string, params: unknown[], method: "run" | "all" | "values" | "get") => {
    const statement = sqlite.prepare(sql);
    if (method === "run") {
      statement.run(...params as []);
      return { rows: [] };
    }
    if (method === "get") {
      const value = statement.get(...params as []);
      return { rows: value ? [Object.values(value)] : [] };
    }
    const values = statement.all(...params as []).map((value) => Object.values(value));
    return { rows: values };
  };
  const database = drizzle<typeof schema>(execute, async (queries) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const [index, query] of queries.entries()) {
        results.push(await execute(query.sql, query.params, query.method));
        if (failAfterStatement === index + 1) throw new Error("injected batch failure");
      }
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }, { schema });
  return { sqlite, database };
}

function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)")
    .run(AUTHOR, "author@example.com", "作者", ORIGINAL_TIME, ORIGINAL_TIME);
  db.prepare("INSERT INTO posts (id, author_id, title, markdown, search_text, current_revision_id, published_at, edited_at, last_activity_at) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?)")
    .run(POST, AUTHOR, "原标题", ORIGINAL_MARKDOWN, "原文 A 与 原文 B", ORIGINAL_TIME, ORIGINAL_TIME);
  db.prepare("INSERT INTO post_revisions (id, post_id, revision_number, kind, title, markdown, created_at, created_by_user_id, restore_source_revision_id) VALUES (?, ?, 1, 'CONTENT_EDIT', ?, ?, ?, ?, NULL)")
    .run(REVISION_1, POST, "原标题", ORIGINAL_MARKDOWN, ORIGINAL_TIME, AUTHOR);
  db.prepare("UPDATE posts SET current_revision_id = ? WHERE id = ?").run(REVISION_1, POST);
  db.prepare("INSERT INTO import_batches (id, importer_user_id, source_filename, source_sha256, post_id, revision_id, committed_at) VALUES (?, ?, 'source.docx', ?, ?, ?, ?)")
    .run(IMPORT_BATCH, AUTHOR, "a".repeat(64), POST, REVISION_1, ORIGINAL_TIME);
  db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key) VALUES (?, ?, ?, '批注 A', '原文 A', ?, ?, ?)")
    .run(A, POST, AUTHOR, ORIGINAL_TIME, REVISION_1, "00000000-0000-4000-8000-000000000009");
  db.prepare("INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, source_type, source_author_name, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id) VALUES (?, ?, NULL, '批注 B', '原文 B', ?, ?, ?, 'DOCX_IMPORT', 'Word 作者', 'comment-b', 0, 0, ?, ?)")
    .run(B, POST, ORIGINAL_TIME, REVISION_1, `docx:${IMPORT_BATCH}:comment-b`, IMPORT_BATCH, AUTHOR);
  db.prepare("INSERT INTO annotation_replies (id, annotation_id, author_id, content_markdown, submission_key, created_at, source_type, source_author_name, source_comment_id, source_document_order, source_resolved, import_batch_id, imported_by_user_id) VALUES (?, ?, NULL, '导入回复', ?, ?, 'DOCX_IMPORT', 'Word 回复者', 'reply-b', 1, 0, ?, ?)")
    .run(IMPORTED_REPLY, B, `docx:${IMPORT_BATCH}:reply-b`, ORIGINAL_TIME, IMPORT_BATCH, AUTHOR);
  for (const id of [A, B]) {
    db.prepare("INSERT INTO post_annotation_anchors (post_id, annotation_id) VALUES (?, ?)").run(POST, id);
    db.prepare("INSERT INTO revision_annotation_states (revision_id, annotation_id, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id) VALUES (?, ?, NULL, NULL, NULL, NULL)").run(REVISION_1, id);
  }
  db.prepare("INSERT INTO revision_imported_reply_states (revision_id, annotation_reply_id, deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id) VALUES (?, ?, NULL, NULL, NULL, NULL)")
    .run(REVISION_1, IMPORTED_REPLY);
}

function row(db: DatabaseSync, sql: string, ...params: unknown[]): Record<string, unknown> {
  return { ...(db.prepare(sql).get(...params as []) ?? {}) };
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }).value);
}
