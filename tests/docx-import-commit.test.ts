import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  DocxImportCommitSchema,
  parseDocxImportCommitBody,
  prepareDocxImportSubmission,
  toDocxImportCommitPayload,
  type DocxImportCommitInput,
} from "../lib/docx-import/commit-schema.ts";
import {
  planDocxImportCommit,
  validateDocxImportCommitPayload,
  type SqlValue,
} from "../lib/docx-import/commit-plan.ts";
import {
  commitDocxImport,
  type DocxImportCommitDatabase,
  type D1StatementPlan,
} from "../lib/docx-import/commit-service.ts";
import { beginDocxImportCommit } from "../lib/docx-import/commit-lock.ts";
import type { CommitSafeImportPreview } from "../lib/docx-import/preview-validation.ts";
import type { ListBlock } from "../lib/docx-import/types.ts";

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

  const oversizedIrText = commitFixture();
  oversizedIrText.ir.blocks.push(
    { id: "large-1", type: "paragraph", segments: [{ text: "a".repeat(800_000), marks: [], commentIds: [] }] },
    { id: "large-2", type: "paragraph", segments: [{ text: "b".repeat(800_000), marks: [], commentIds: [] }] },
  );
  assert.throws(() => validateDocxImportCommitPayload(oversizedIrText), /IR_TEXT_SIZE_LIMIT/);

  const recursiveList = commitFixture();
  recursiveList.ir.blocks.push(nestedListBlock(0, 20));
  assert.throws(() => validateDocxImportCommitPayload(recursiveList), /COMMIT_SCHEMA_INVALID/);

  const nestedWarning = commitFixture();
  (nestedWarning.ir.warnings as unknown[]).push({
    code: "VISUAL_FORMATTING_DROPPED",
    severity: "warning",
    payload: { nested: { arbitrary: true } },
  });
  assert.throws(() => validateDocxImportCommitPayload(nestedWarning), /COMMIT_SCHEMA_INVALID/);

  const tableExpansion = commitFixture();
  tableExpansion.ir.blocks.push({
    id: "large-table",
    type: "table",
    header: { cells: Array.from({ length: 100 }, () => ({ segments: [] })) },
    rows: Array.from({ length: 101 }, () => ({
      cells: Array.from({ length: 100 }, () => ({ segments: [] })),
    })),
  });
  assert.throws(() => validateDocxImportCommitPayload(tableExpansion), /IR_NODE_LIMIT/);

  const warningExpansion = commitFixture();
  warningExpansion.ir.warnings.push({
    code: "VISUAL_FORMATTING_DROPPED",
    severity: "warning",
    payload: Object.fromEntries(Array.from({ length: 20_000 }, (_, index) => [`field-${index}`, index])),
  });
  assert.throws(() => validateDocxImportCommitPayload(warningExpansion), /COMMIT_SCHEMA_INVALID/);

  const aggregateWarnings = commitFixture();
  aggregateWarnings.ir.warnings = Array.from({ length: 500 }, (_, warningIndex) => ({
    code: "VISUAL_FORMATTING_DROPPED" as const,
    severity: "warning" as const,
    payload: Object.fromEntries(Array.from({ length: 20 }, (_, fieldIndex) => [
      `field-${warningIndex}-${fieldIndex}`,
      fieldIndex,
    ])),
  }));
  assert.throws(() => validateDocxImportCommitPayload(aggregateWarnings), /IR_NODE_LIMIT/);
});

test("the IR budget counts repeated segment links and comment IDs", () => {
  const linked = commitFixture();
  const linkedParagraph = linked.ir.blocks[0]!;
  assert.equal(linkedParagraph.type, "paragraph");
  if (linkedParagraph.type !== "paragraph") return;
  linkedParagraph.segments.push(...Array.from({ length: 400 }, (_, index) => ({
    text: "x",
    marks: [],
    link: `https://${"a".repeat(4_070)}${index.toString(36)}`,
    commentIds: [],
  })));
  assert.throws(() => validateDocxImportCommitPayload(linked), /IR_TEXT_SIZE_LIMIT/);

  const commented = commitFixture();
  const commentedParagraph = commented.ir.blocks[0]!;
  assert.equal(commentedParagraph.type, "paragraph");
  if (commentedParagraph.type !== "paragraph") return;
  commentedParagraph.segments.push(...Array.from({ length: 16 }, () => ({
    text: "x",
    marks: [],
    commentIds: Array.from({ length: 500 }, () => "c".repeat(200)),
  })));
  assert.throws(() => validateDocxImportCommitPayload(commented), /IR_TEXT_SIZE_LIMIT/);
});

test("the raw commit body is size-limited before JSON parsing", () => {
  const oversized = commitFixture();
  const paragraph = oversized.ir.blocks[0]!;
  assert.equal(paragraph.type, "paragraph");
  if (paragraph.type !== "paragraph") return;
  paragraph.segments.push(...Array.from({ length: 1_600 }, (_, index) => ({
    text: "x",
    marks: [],
    link: `https://${"a".repeat(4_070)}${index.toString(36)}`,
    commentIds: [],
  })));
  const body = JSON.stringify(oversized);
  assert.ok(new TextEncoder().encode(body).byteLength > 6 * 1024 * 1024);
  assert.throws(() => parseDocxImportCommitBody(body), /COMMIT_BODY_SIZE_LIMIT/);
  assert.throws(() => parseDocxImportCommitBody("{"), /COMMIT_SCHEMA_INVALID/);
});

test("the browser synchronously locks Confirm before its first durable checkpoint", () => {
  const lock = { current: false };
  let phase = "previewing";

  assert.equal(beginDocxImportCommit(lock, () => { phase = "committing"; }), true);
  assert.equal(lock.current, true);
  assert.equal(phase, "committing");
  assert.equal(beginDocxImportCommit(lock, () => { phase = "previewing"; }), false);
  assert.equal(phase, "committing");
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

  const imageAnchor = commitFixture();
  imageAnchor.markdown = `:annotation[![正文](https://example.com/image.png)]{#${ROOT_ID}}`;
  imageAnchor.ir.canonicalMarkdown = imageAnchor.markdown;
  assert.throws(() => validateDocxImportCommitPayload(imageAnchor), /ANNOTATION_NON_TEXT_RANGE/);
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
  const preview = previewFixtureWithAsset();
  const payload = toDocxImportCommitPayload(preview);
  assert.equal(payload.importBatchId, BATCH_ID);
  assert.equal(payload.ir.threads[0]?.annotationId, ROOT_ID);
  assert.equal(payload.ir.threads[0]?.replies[0]?.replyId, REPLY_ID);
  assert.equal("bytes" in payload.ir.assets[0]!, false);
  assert.equal(JSON.stringify(payload).includes("1,2,3"), false);

  const submission = prepareDocxImportSubmission(preview);
  assert.deepEqual(JSON.parse(submission.body), payload);
  assert.equal(submission.preview.title, preview.title);
  assert.equal(submission.preview.canonicalMarkdown, preview.markdown);
  assert.equal(submission.preview.ir.canonicalMarkdown, preview.markdown);
  assert.equal(submission.preview.importBatchId, payload.importBatchId);
  assert.equal(submission.preview.ir.threads[0]?.annotationId, payload.ir.threads[0]?.annotationId);
});

test("the pure planner chunks rows and creates one normal post activity only", () => {
  const validated = validateDocxImportCommitPayload(manyRootFixture(12));
  const plan = planDocxImportCommit(validated, {
    importerUserId: IMPORTER_ID,
    postId: uuid(600),
    revisionId: uuid(601),
    eventId: "activity:test",
    payloadHash: "b".repeat(64),
    now: new Date("2026-08-30T00:00:00.000Z"),
    assets: [],
  });

  assert.ok(plan.statements.length > 0);
  assert.ok(plan.rowChunks.every((chunk) => chunk.rowCount <= 32));
  assert.ok(plan.statements.every((statement) => statement.params.length <= 100));
  assert.equal(plan.activityCount, 1);
  assert.equal(plan.annotationActivityCount, 0);
  assert.equal(plan.notificationCount, 1);
});

test("the service keeps every lookup and batch statement within D1's 100-bind ceiling", async () => {
  const input = manyRootFixture(101, true);
  const parameterCounts: number[] = [];
  const adapter: DocxImportCommitDatabase = {
    async first<T>(sql: string, params: readonly SqlValue[]) {
      parameterCounts.push(params.length);
      if (params.length > 100) throw new Error("D1_BIND_LIMIT");
      return (sql.includes("INNER JOIN allowed_users") ? { id: IMPORTER_ID } : null) as T | null;
    },
    async all<T>(sql: string, params: readonly SqlValue[]) {
      parameterCounts.push(params.length);
      if (params.length > 100) throw new Error("D1_BIND_LIMIT");
      if (sql.includes("INNER JOIN allowed_users")) return params.map((id) => ({ id })) as T[];
      return [];
    },
    async batch(statements: readonly D1StatementPlan[]) {
      for (const statement of statements) {
        parameterCounts.push(statement.params.length);
        if (statement.params.length > 100) throw new Error("D1_BIND_LIMIT");
      }
    },
  };

  const result = await commitDocxImport(IMPORTER_ID, input, adapter);
  assert.equal(result.alreadyCommitted, false);
  assert.ok(parameterCounts.length > 3);
  assert.ok(parameterCounts.every((count) => count <= 100));
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

function commitFixture(options: { withAsset?: boolean } = {}): DocxImportCommitInput {
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

function manyRootFixture(count: number, uniqueAuthors = false) {
  const input = commitFixture();
  input.ir.blocks = [];
  input.ir.threads = [];
  input.authorMappings = {};
  const markdown: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const annotationId = `ann_${uuid(10_000 + index)}`;
    const author = uniqueAuthors ? `Author ${index}` : "Author";
    const attributedUserId = uniqueAuthors ? uuid(20_000 + index) : MEMBER_ID;
    const blockId = `p-${index}`;
    input.ir.blocks.push({
      id: blockId,
      type: "paragraph",
      segments: [{ text: "正文", marks: [], commentIds: [`root-${index}`] }],
    });
    input.ir.threads.push({
      ...commitFixture().ir.threads[0]!,
      annotationId,
      sourceCommentId: `root-${index}`,
      blockId,
      sourceAuthorName: author,
      sourceDocumentOrder: index,
      replies: [],
    });
    input.authorMappings[author] = attributedUserId;
    markdown.push(`:annotation[正文]{#${annotationId}}`);
  }
  input.markdown = markdown.join("\n\n");
  input.ir.canonicalMarkdown = input.markdown;
  return input;
}

function nestedListBlock(depth: 0 | 1 | 2, remaining: number): ListBlock {
  return {
    id: `list-${remaining}`,
    type: "list",
    ordered: false,
    depth,
    items: [{
      id: `list-item-${remaining}`,
      segments: [{ text: "item", marks: [], commentIds: [] }],
      children: remaining > 0 ? [nestedListBlock(Math.min(depth + 1, 2) as 0 | 1 | 2, remaining - 1)] : [],
    }],
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
