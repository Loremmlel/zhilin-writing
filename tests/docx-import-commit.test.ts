import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  DocxImportCommitSchema,
  toDocxImportCommitPayload,
} from "../lib/docx-import/commit-schema.ts";
import {
  planDocxImportCommit,
  validateDocxImportCommitPayload,
} from "../lib/docx-import/commit-plan.ts";
import {
  commitDocxImport,
  type DocxImportCommitDatabase,
  type D1StatementPlan,
} from "../lib/docx-import/commit-service.ts";
import type { CommitSafeImportPreview } from "../lib/docx-import/preview-validation.ts";

const IMPORTER_ID = "00000000-0000-4000-8000-000000000101";
const MEMBER_ID = "00000000-0000-4000-8000-000000000102";
const ROOT_ID = "ann_00000000-0000-4000-8000-000000000201";
const SECOND_ROOT_ID = "ann_00000000-0000-4000-8000-000000000202";
const REPLY_ID = "00000000-0000-4000-8000-000000000301";
const BATCH_ID = "00000000-0000-4000-8000-000000000401";
const ASSET_ID = "00000000-0000-4000-8000-000000000501";
const SHA256 = "a".repeat(64);

test("the commit schema rejects unknown fields and forged native authorship", () => {
  const unknown = DocxImportCommitSchema.safeParse({ ...commitFixture(), forged: true });
  assert.equal(unknown.success, false);

  const forged = commitFixture();
  forged.ir.threads[0]!.authorId = MEMBER_ID;
  assert.throws(
    () => validateDocxImportCommitPayload(forged),
    /IMPORTED_AUTHOR_MUST_BE_NULL/,
  );
});

test("the trust boundary enforces title, Markdown, UUID, uniqueness, and item limits", () => {
  assert.throws(
    () => validateDocxImportCommitPayload({ ...commitFixture(), title: " ".repeat(2) }),
    /TITLE_REQUIRED/,
  );
  assert.throws(
    () => validateDocxImportCommitPayload({ ...commitFixture(), markdown: "中".repeat(500_001) }),
    /MARKDOWN_SIZE_LIMIT/,
  );

  const malformed = commitFixture();
  malformed.ir.threads[0]!.annotationId = "ann-forged";
  assert.throws(() => validateDocxImportCommitPayload(malformed), /ANNOTATION_ID_INVALID/);

  const malformedReply = commitFixture();
  malformedReply.ir.threads[0]!.replies[0]!.replyId = "reply-forged";
  assert.throws(() => validateDocxImportCommitPayload(malformedReply), /REPLY_ID_INVALID/);

  const duplicate = commitFixture();
  duplicate.ir.threads.push({ ...duplicate.ir.threads[0]!, replies: [] });
  assert.throws(() => validateDocxImportCommitPayload(duplicate), /ANNOTATION_ID_DUPLICATE/);

  const overLimit = commitFixture();
  overLimit.ir.threads[0]!.replies = Array.from({ length: 500 }, (_, index) => ({
    ...overLimit.ir.threads[0]!.replies[0]!,
    replyId: uuid(index + 1_000),
    sourceCommentId: `reply-${index}`,
    sourceDocumentOrder: index + 1,
  }));
  assert.throws(() => validateDocxImportCommitPayload(overLimit), /COMMENT_LIMIT/);
});

test("the server reparses Markdown and rejects missing, extra, changed, nested, or unsafe anchors", () => {
  const missing = commitFixture();
  missing.markdown = "正文";
  missing.ir.canonicalMarkdown = missing.markdown;
  assert.throws(() => validateDocxImportCommitPayload(missing), /ANNOTATION_ANCHOR_MISSING/);

  const extra = commitFixture();
  extra.markdown += `\n\n:annotation[额外]{#${SECOND_ROOT_ID}}`;
  extra.ir.canonicalMarkdown = extra.markdown;
  assert.throws(() => validateDocxImportCommitPayload(extra), /ANNOTATION_ANCHOR_UNKNOWN/);

  const changed = commitFixture();
  changed.markdown = `:annotation[正稿]{#${ROOT_ID}}`;
  changed.ir.canonicalMarkdown = changed.markdown;
  assert.throws(() => validateDocxImportCommitPayload(changed), /ANNOTATION_TEXT_CHANGED/);

  const nested = commitFixture();
  nested.markdown = `:annotation[:annotation[正文]{#${SECOND_ROOT_ID}}]{#${ROOT_ID}}`;
  nested.ir.canonicalMarkdown = nested.markdown;
  assert.throws(() => validateDocxImportCommitPayload(nested), /ANNOTATION_NESTED/);

  const unsafe = commitFixture();
  unsafe.markdown = `:annotation[[正文](javascript:alert(1))]{#${ROOT_ID}}`;
  unsafe.ir.canonicalMarkdown = unsafe.markdown;
  assert.throws(() => validateDocxImportCommitPayload(unsafe), /UNSAFE_EXTERNAL_URL/);
});

test("the server rejects forged source ranges, reply graphs, mappings, and asset manifests", () => {
  const overlap = commitFixture();
  overlap.ir.threads.push({
    ...overlap.ir.threads[0]!,
    annotationId: SECOND_ROOT_ID,
    sourceCommentId: "20",
    blockLocalStart: 1,
    blockLocalEnd: 2,
    replies: [],
  });
  overlap.markdown = `:annotation[正]{#${ROOT_ID}}:annotation[文]{#${SECOND_ROOT_ID}}`;
  overlap.ir.canonicalMarkdown = overlap.markdown;
  assert.throws(() => validateDocxImportCommitPayload(overlap), /ANNOTATION_OVERLAP/);

  const badParent = commitFixture();
  badParent.ir.threads[0]!.replies[0]!.parentSourceCommentId = "missing";
  assert.throws(() => validateDocxImportCommitPayload(badParent), /REPLY_PARENT_INVALID/);

  const badMapping = commitFixture();
  (badMapping.authorMappings as Record<string, string>).Unknown = MEMBER_ID;
  assert.throws(() => validateDocxImportCommitPayload(badMapping), /AUTHOR_MAPPING_INVALID/);

  const badAsset = commitFixture({ withAsset: true });
  badAsset.temporaryAssets[0]!.temporaryUrl = "https://evil.example/image.png";
  assert.throws(() => validateDocxImportCommitPayload(badAsset), /ASSET_REFERENCE_INVALID/);
});

test("the browser commit payload omits image bytes and preserves finalized retry IDs", () => {
  const payload = toDocxImportCommitPayload(previewFixtureWithAsset());
  assert.equal(payload.importBatchId, BATCH_ID);
  assert.equal(payload.ir.threads[0]?.annotationId, ROOT_ID);
  assert.equal(payload.ir.threads[0]?.replies[0]?.replyId, REPLY_ID);
  assert.equal("bytes" in payload.ir.assets[0]!, false);
  assert.equal(JSON.stringify(payload).includes("1,2,3"), false);
});

test("the pure planner chunks rows and creates one normal post activity only", () => {
  const validated = validateDocxImportCommitPayload(commitFixture({ withAsset: true }));
  const plan = planDocxImportCommit(validated, {
    importerUserId: IMPORTER_ID,
    postId: uuid(600),
    revisionId: uuid(601),
    eventId: "activity:test",
    payloadHash: "b".repeat(64),
    now: new Date("2026-08-30T00:00:00.000Z"),
    assets: [{ id: ASSET_ID, ownerId: IMPORTER_ID, kind: "image", mimeType: "image/png", status: "temporary", deletedAt: null }],
  });

  assert.ok(plan.statements.length > 0);
  assert.ok(plan.rowChunks.every((chunk) => chunk.rowCount <= 32));
  assert.equal(plan.activityCount, 1);
  assert.equal(plan.annotationActivityCount, 0);
  assert.equal(plan.notificationCount, 1);
});

test("the service rejects non-members, invalid attribution, and unclaimable assets", async () => {
  const harness = await createHarness();
  try {
    await assert.rejects(
      commitDocxImport(uuid(999), commitFixture(), harness.adapter),
      /MEMBER_REQUIRED/,
    );

    const invalidAttribution = commitFixture();
    invalidAttribution.authorMappings = { Author: uuid(998) };
    await assert.rejects(
      commitDocxImport(IMPORTER_ID, invalidAttribution, harness.adapter),
      /ATTRIBUTED_USER_INVALID/,
    );

    const unowned = commitFixture({ withAsset: true });
    harness.db.prepare("UPDATE assets SET owner_id = ? WHERE id = ?").run(MEMBER_ID, ASSET_ID);
    await assert.rejects(
      commitDocxImport(IMPORTER_ID, unowned, harness.adapter),
      /ASSET_NOT_CLAIMABLE/,
    );

    harness.db.prepare("UPDATE assets SET owner_id = ?, status = 'permanent' WHERE id = ?").run(IMPORTER_ID, ASSET_ID);
    await assert.rejects(
      commitDocxImport(IMPORTER_ID, commitFixture({ withAsset: true }), harness.adapter),
      /ASSET_NOT_CLAIMABLE/,
    );

    harness.db.prepare("UPDATE assets SET status = 'temporary', mime_type = 'image/jpeg' WHERE id = ?").run(ASSET_ID);
    await assert.rejects(
      commitDocxImport(IMPORTER_ID, commitFixture({ withAsset: true }), harness.adapter),
      /ASSET_NOT_CLAIMABLE/,
    );
  } finally {
    harness.db.close();
  }
});

test("an atomic commit persists one complete initial state and exact retry returns it", async () => {
  const harness = await createHarness();
  try {
    const input = commitFixture({ withAsset: true });
    const first = await commitDocxImport(IMPORTER_ID, input, harness.adapter);
    const retry = await commitDocxImport(IMPORTER_ID, input, harness.adapter);

    assert.equal(first.alreadyCommitted, false);
    assert.deepEqual(retry, { ...first, alreadyCommitted: true });
    assert.equal(count(harness.db, "posts"), 1);
    assert.equal(count(harness.db, "post_revisions"), 1);
    assert.equal(count(harness.db, "annotations"), 1);
    assert.equal(count(harness.db, "annotation_replies"), 1);
    assert.equal(count(harness.db, "post_annotation_anchors"), 1);
    assert.equal(count(harness.db, "revision_annotation_states"), 1);
    assert.equal(count(harness.db, "revision_imported_reply_states"), 1);
    assert.equal(count(harness.db, "activity_events"), 1);
    assert.equal(count(harness.db, "notifications"), 1);
    assert.deepEqual(
      { ...harness.db.prepare("SELECT status, post_id, expires_at FROM assets WHERE id = ?").get(ASSET_ID) },
      { status: "permanent", post_id: first.postId, expires_at: null },
    );
  } finally {
    harness.db.close();
  }
});

test("same batch with another importer, source hash, or durable payload conflicts", async () => {
  const harness = await createHarness();
  try {
    const input = commitFixture();
    await commitDocxImport(IMPORTER_ID, input, harness.adapter);

    await assert.rejects(commitDocxImport(MEMBER_ID, input, harness.adapter), /IMPORT_BATCH_CONFLICT/);
    const changedSource = structuredClone(input);
    changedSource.source.sha256 = "b".repeat(64);
    changedSource.ir.source.sha256 = changedSource.source.sha256;
    await assert.rejects(
      commitDocxImport(IMPORTER_ID, changedSource, harness.adapter),
      /IMPORT_BATCH_CONFLICT/,
    );
    await assert.rejects(
      commitDocxImport(IMPORTER_ID, { ...input, title: "另一篇标题" }, harness.adapter),
      /IMPORT_BATCH_CONFLICT/,
    );
    assert.equal(count(harness.db, "posts"), 1);
  } finally {
    harness.db.close();
  }
});

test("a mid-batch failure rolls back every D1 relation and leaves assets temporary", async () => {
  const harness = await createHarness(5);
  try {
    await assert.rejects(
      commitDocxImport(IMPORTER_ID, commitFixture({ withAsset: true }), harness.adapter),
      /IMPORT_COMMIT_FAILED/,
    );
    for (const table of [
      "import_batches", "posts", "post_revisions", "annotations", "annotation_replies",
      "post_annotation_anchors", "revision_annotation_states", "revision_imported_reply_states",
      "post_asset_refs", "revision_asset_refs", "activity_events", "notifications",
    ]) assert.equal(count(harness.db, table), 0, table);
    assert.deepEqual(
      { ...harness.db.prepare("SELECT status, post_id FROM assets WHERE id = ?").get(ASSET_ID) },
      { status: "temporary", post_id: null },
    );
  } finally {
    harness.db.close();
  }
});

function commitFixture(options: { withAsset?: boolean } = {}) {
  const withAsset = options.withAsset ?? false;
  return {
    version: 1 as const,
    importBatchId: BATCH_ID,
    source: { filename: "source.docx", sha256: SHA256 },
    title: "导入标题",
    markdown: `:annotation[正文]{#${ROOT_ID}}${withAsset ? `\n\n![image](/api/assets/${ASSET_ID})` : ""}`,
    ir: {
      version: 1 as const,
      importBatchId: BATCH_ID,
      source: { filename: "source.docx", sha256: SHA256, producer: "Word" },
      suggestedTitle: "导入标题",
      blocks: [
        { id: "p1", type: "paragraph" as const, segments: [{ text: "正文", marks: [], commentIds: ["10"] }] },
        ...(withAsset ? [{ id: "image-block", type: "image" as const, assetId: "docx-image-1", alt: "image" }] : []),
      ],
      assets: withAsset ? [{ id: "docx-image-1", filename: "image.png", mimeType: "image/png" as const, alt: "image", sourceRelationshipId: "rImage", floating: false }] : [],
      threads: [{
        annotationId: ROOT_ID,
        authorId: null as string | null,
        sourceCommentId: "10",
        blockId: "p1",
        blockLocalStart: 0,
        blockLocalEnd: 2,
        sourceAuthorName: "Author",
        sourceInitials: "AU",
        sourceCreatedAt: "2026-08-29T00:00:00.000Z",
        sourceDocumentOrder: 0,
        sourceResolved: false,
        bodyMarkdown: "Root",
        replies: [{
          replyId: REPLY_ID,
          authorId: null as string | null,
          sourceCommentId: "11",
          parentSourceCommentId: "10",
          sourceAuthorName: "Reply Author",
          sourceDocumentOrder: 1,
          sourceResolved: false,
          bodyMarkdown: "Reply",
        }],
      }],
      skippedThreads: [],
      warnings: [],
      canonicalMarkdown: `:annotation[正文]{#${ROOT_ID}}${withAsset ? `\n\n![image](/api/assets/${ASSET_ID})` : ""}`,
    },
    temporaryAssets: withAsset ? [{ assetId: ASSET_ID, temporaryUrl: `/api/assets/${ASSET_ID}`, filename: "image.png", mimeType: "image/png" as const }] : [],
    authorMappings: { Author: MEMBER_ID },
  };
}

function previewFixtureWithAsset(): CommitSafeImportPreview {
  const input = commitFixture({ withAsset: true });
  return {
    version: 1,
    importBatchId: input.importBatchId,
    title: input.title,
    createdAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2099-08-30T00:00:00.000Z",
    ir: {
      ...input.ir,
      assets: input.ir.assets.map((asset) => ({ ...asset, bytes: new Uint8Array([1, 2, 3]) })),
      threads: input.ir.threads.map((value) => {
        const { authorId, ...thread } = value;
        assert.equal(authorId, null);
        return {
          ...thread,
          replies: thread.replies.map((replyValue) => {
            const { authorId: replyAuthorId, ...reply } = replyValue;
            assert.equal(replyAuthorId, null);
            return reply;
          }),
        };
      }),
    },
    markdown: input.markdown,
    canonicalMarkdown: input.markdown,
    temporaryAssets: input.temporaryAssets,
    authorMappings: input.authorMappings,
  };
}

async function createHarness(failAfterStatement?: number) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const prefix of ["0000_", "0001_", "0002_", "0003_", "0004_", "0005_"]) {
    const filename = (await readdir(new URL("../drizzle/", import.meta.url))).find((item) => item.startsWith(prefix) && item.endsWith(".sql"));
    assert.ok(filename, `${prefix} migration must exist`);
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  }
  const now = Date.parse("2026-08-29T00:00:00.000Z");
  const insertAllowed = db.prepare("INSERT INTO allowed_users (id, email, is_admin, added_at) VALUES (?, ?, 0, ?)");
  const insertUser = db.prepare("INSERT INTO users (id, email_key, display_name, bio, joined_at, updated_at) VALUES (?, ?, ?, '', ?, ?)");
  insertAllowed.run("allowed-importer", "importer@example.com", now);
  insertAllowed.run("allowed-member", "member@example.com", now);
  insertUser.run(IMPORTER_ID, "importer@example.com", "Importer", now, now);
  insertUser.run(MEMBER_ID, "member@example.com", "Member", now, now);
  db.prepare("INSERT INTO assets (id, owner_id, r2_key, kind, filename, mime_type, byte_size, status, created_at, expires_at) VALUES (?, ?, ?, 'image', 'image.png', 'image/png', 3, 'temporary', ?, ?)")
    .run(ASSET_ID, IMPORTER_ID, `${IMPORTER_ID}/image/${ASSET_ID}`, now, now + 86_400_000);

  let batchAttempt = 0;
  const adapter: DocxImportCommitDatabase = {
    async first<T>(sql: string, params: readonly unknown[]) {
      return (db.prepare(sql).get(...params as []) as T | undefined) ?? null;
    },
    async all<T>(sql: string, params: readonly unknown[]) {
      return db.prepare(sql).all(...params as []) as T[];
    },
    async batch(statements: readonly D1StatementPlan[]) {
      db.exec("BEGIN");
      try {
        for (const [index, statement] of statements.entries()) {
          db.prepare(statement.sql).run(...statement.params as []);
          if (batchAttempt === 0 && failAfterStatement !== undefined && index + 1 === failAfterStatement) {
            throw new Error("injected batch failure");
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        batchAttempt += 1;
      }
    },
  };
  return { db, adapter };
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }).value);
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
