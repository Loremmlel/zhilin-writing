import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";

import { posts } from "../db/schema.ts";
import {
  buildAnnotationReplyLifecycleViews,
  planAnnotationAdminTransition,
  planAnnotationAuthorDelete,
  planImportedAnnotationThreadRemoval,
} from "../lib/annotations/lifecycle.ts";

const root = {
  id: "a",
  postId: "p",
  authorId: "a",
  contentMarkdown: "root",
  originalSelectedText: "text",
  createdAt: new Date(),
  createdOnRevisionId: "r",
  submissionKey: "k",
  deletedAt: null,
  deletedByUserId: null,
  hiddenAt: null,
  hiddenByUserId: null,
  hiddenReason: null,
};
type ReplyFixture = {
  id: string;
  annotationId: string;
  authorId: string | null;
  replyToUserId: string | null;
  replyToReplyId: string | null;
  contentMarkdown: string;
  submissionKey: string;
  createdAt: Date;
  deletedAt: Date | null;
  deletedByUserId: string | null;
  hiddenAt: Date | null;
  hiddenByUserId: string | null;
  hiddenReason: string | null;
  sourceType: "NATIVE" | "DOCX_IMPORT";
  importedByUserId: string | null;
};
const reply = (overrides: Partial<ReplyFixture> = {}): ReplyFixture => ({
  id: "r1",
  annotationId: "a",
  authorId: "b",
  replyToUserId: "a",
  replyToReplyId: null,
  contentMarkdown: "reply",
  submissionKey: "k",
  createdAt: new Date(),
  deletedAt: null,
  deletedByUserId: null,
  hiddenAt: null,
  hiddenByUserId: null,
  hiddenReason: null,
  sourceType: "NATIVE",
  importedByUserId: null,
  ...overrides,
});

test("deleting a root removes its anchor only when no other member discussion depends on it", () => {
  assert.equal(planAnnotationAuthorDelete(root, [], "a", new Date()).retainAnchor, false);
  assert.equal(planAnnotationAuthorDelete(root, [reply()], "a", new Date()).retainAnchor, true);
  assert.equal(
    planAnnotationAuthorDelete(
      root,
      [reply({ hiddenAt: new Date(), hiddenByUserId: "admin" })],
      "a",
      new Date(),
    ).retainAnchor,
    true,
  );
  assert.equal(
    planAnnotationAuthorDelete(root, [reply({ authorId: "a" })], "a", new Date()).retainAnchor,
    false,
  );
});

test("deleted replies remain only when a visible direct reply depends on them", () => {
  const deleted = reply({ id: "r1", deletedAt: new Date(), deletedByUserId: "b" });
  assert.deepEqual(buildAnnotationReplyLifecycleViews([deleted]), []);
  const views = buildAnnotationReplyLifecycleViews([
    deleted,
    reply({ id: "r2", authorId: "c", replyToReplyId: "r1" }),
  ]);
  assert.equal(views[0]?.contentVisible, false);
  assert.match(views[0]?.placeholder ?? "", /作者删除/);
  assert.equal(views.length, 2);
});

test("a notification deep link can retain an unavailable annotation reply placeholder", () => {
  const deleted = reply({ id: "target", deletedAt: new Date(), deletedByUserId: "b" });
  const views = buildAnnotationReplyLifecycleViews([deleted], {
    requiredPlaceholderIds: ["target"],
  });
  assert.equal(views.length, 1);
  assert.equal(views[0]?.contentVisible, false);
  assert.equal(views[0]?.placeholder, "该回复已被作者删除。");
});

test("administrator moderation snapshots current roots but not reply-only visibility", () => {
  const hiddenRoot = planAnnotationAdminTransition({
    targetType: "ANNOTATION",
    targetId: "a",
    record: root,
    administratorId: "admin",
    operation: "hide",
    operationId: "op-a",
    reason: "越界",
    currentAnchor: true,
    now: new Date(10),
  });
  assert.equal(hiddenRoot.createAnnotationStateRevision, true);
  assert.equal(hiddenRoot.audit?.actionType, "ANNOTATION_HIDDEN");
  assert.equal("hiddenReason" in hiddenRoot.patch ? hiddenRoot.patch.hiddenReason : null, "越界");

  const hiddenReply = planAnnotationAdminTransition({
    targetType: "ANNOTATION_REPLY",
    targetId: "r1",
    record: reply(),
    administratorId: "admin",
    operation: "hide",
    operationId: "op-r",
    currentAnchor: true,
    now: new Date(20),
  });
  assert.equal(hiddenReply.createAnnotationStateRevision, false);
  assert.equal(hiddenReply.audit?.actionType, "ANNOTATION_REPLY_HIDDEN");
});

test("imported thread removal unwraps without native replies and retains native discussion without cascading", () => {
  const importedRoot = {
    ...root,
    authorId: null,
    sourceType: "DOCX_IMPORT" as const,
    importedByUserId: "importer",
  };
  const importedReply = reply({
    id: "word-reply",
    authorId: null,
    sourceType: "DOCX_IMPORT",
    importedByUserId: "importer",
  });
  const nativeReply = reply({ id: "native-reply", authorId: "member", sourceType: "NATIVE" });

  const withoutNative = planImportedAnnotationThreadRemoval(importedRoot, [importedReply], {
    actorUserId: "importer",
    postAuthorId: "importer",
    now: new Date(100),
  });
  assert.equal(withoutNative.retainAnchor, false);
  assert.deepEqual(withoutNative.importedReplyIds, ["word-reply"]);

  const withNative = planImportedAnnotationThreadRemoval(
    importedRoot,
    [importedReply, nativeReply],
    {
      actorUserId: "importer",
      postAuthorId: "importer",
      now: new Date(200),
    },
  );
  assert.equal(withNative.retainAnchor, true);
  assert.deepEqual(withNative.importedReplyIds, ["word-reply"]);
  assert.equal(withNative.importedReplyIds.includes("native-reply"), false);
});

test("imported thread removal rejects attribution and native roots while admin moderation remains available", () => {
  const importedRoot = {
    ...root,
    authorId: null,
    sourceType: "DOCX_IMPORT" as const,
    importedByUserId: "importer",
  };
  assert.throws(
    () =>
      planImportedAnnotationThreadRemoval(importedRoot, [], {
        actorUserId: "attributed",
        postAuthorId: "post-author",
        now: new Date(),
      }),
    /不能移除/,
  );
  assert.throws(
    () =>
      planImportedAnnotationThreadRemoval(
        { ...root, sourceType: "NATIVE" as const, importedByUserId: null },
        [],
        {
          actorUserId: "a",
          postAuthorId: "a",
          now: new Date(),
        },
      ),
    /不是 Word 导入/,
  );

  const hidden = planAnnotationAdminTransition({
    targetType: "ANNOTATION",
    targetId: "a",
    record: importedRoot,
    administratorId: "admin",
    operation: "hide",
    operationId: "op",
    currentAnchor: true,
    now: new Date(),
  });
  assert.equal(hidden.changed, true);
  assert.equal(hidden.createAnnotationStateRevision, true);
});

test("imported thread unwrapping aborts when a native reply appears after planning", async () => {
  const transactionModule = (await import("../lib/annotations/transaction.ts")) as Record<
    string,
    unknown
  >;
  const buildGuard = transactionModule.buildImportedThreadRemovalPostGuard;
  assert.equal(
    typeof buildGuard,
    "function",
    "removal must expose its transaction-time native-reply guard",
  );

  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        current_revision_id TEXT
      );
      CREATE TABLE annotation_replies (
        id TEXT PRIMARY KEY,
        annotation_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        deleted_at INTEGER
      );
      INSERT INTO posts (id, title, current_revision_id) VALUES ('post', '标题', 'revision');
    `);

    const proxy = drizzle(async () => ({ rows: [] }));
    const guard = (
      buildGuard as (input: {
        currentRevisionId: string;
        annotationId: string;
        retainAnchor: boolean;
      }) => ReturnType<typeof sql>
    )({
      currentRevisionId: "revision",
      annotationId: "annotation",
      retainAnchor: false,
    });
    const guardedUpdate = proxy
      .update(posts)
      .set({ title: sql<string>`CASE WHEN ${guard} THEN ${posts.title} ELSE NULL END` })
      .where(eq(posts.id, "post"))
      .toSQL();

    sqlite
      .prepare(
        "INSERT INTO annotation_replies (id, annotation_id, source_type, deleted_at) VALUES (?, ?, 'NATIVE', NULL)",
      )
      .run("native-reply", "annotation");
    assert.throws(
      () => sqlite.prepare(guardedUpdate.sql).run(...(guardedUpdate.params as [])),
      /NOT NULL constraint failed/,
    );
    assert.equal(
      (sqlite.prepare("SELECT title FROM posts WHERE id = 'post'").get() as { title: string })
        .title,
      "标题",
    );
  } finally {
    sqlite.close();
  }
});
