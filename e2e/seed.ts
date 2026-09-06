import { readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Miniflare } from "miniflare";

import {
  E2E_ANNOTATION_REPLIES,
  E2E_ANNOTATIONS,
  E2E_DISCOVERY_POSTS,
  E2E_IMPORT_BATCH,
  E2E_POSTS,
  E2E_TAG,
  E2E_USERS,
  uuid,
} from "./data.ts";

const DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const BUCKET_NAME = "site-creator-r2";
const BASE_TIME = Date.parse("2026-09-01T00:00:00.000Z");

type SeedPost = {
  id: string;
  revisionId: string;
  title: string;
  markdown: string;
  authorId?: string;
  publishedAt?: number;
  editedAt?: number | null;
  deletedAt?: number | null;
  deletedByUserId?: string | null;
  hiddenAt?: number | null;
  hiddenByUserId?: string | null;
  hiddenReason?: string | null;
};

export async function prepareE2EState(stateDirectory: string): Promise<void> {
  await requireOwnedStateDirectory(stateDirectory);
  const miniflare = new Miniflare({
    compatibilityDate: "2026-09-01",
    defaultPersistRoot: resolve(stateDirectory, "v3"),
    d1Databases: { DB: DATABASE_ID },
    r2Buckets: { BUCKET: BUCKET_NAME },
    modules: true,
    script: "export default { fetch() { return new Response('e2e seed'); } }",
  });

  try {
    const database = await miniflare.getD1Database("DB");
    await applyMigrations(database);
    await seedDatabase(database);
  } finally {
    await miniflare.dispose();
  }
}

async function requireOwnedStateDirectory(stateDirectory: string): Promise<void> {
  const directory = await realpath(resolve(stateDirectory));
  const systemTemp = await realpath(tmpdir());
  if (dirname(directory) !== systemTemp || !basename(directory).startsWith("zhilin-e2e-")) {
    throw new Error(`Refusing non-temporary E2E state directory: ${directory}`);
  }
}

async function applyMigrations(database: D1Database): Promise<void> {
  const migrationDirectory = resolve("drizzle");
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort();

  for (const filename of filenames) {
    const sql = await readFile(resolve(migrationDirectory, filename), "utf8");
    await database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
}

async function seedDatabase(database: D1Database): Promise<void> {
  await run(database, "PRAGMA foreign_keys = ON");

  for (const [index, user] of Object.values(E2E_USERS)
    .filter((user) => user !== E2E_USERS.outsider)
    .entries()) {
    await run(
      database,
      "INSERT INTO allowed_users (id, email, is_admin, added_at, added_by_user_id) VALUES (?, ?, ?, ?, ?)",
      uuid(110 + index),
      user.email,
      user === E2E_USERS.admin ? 1 : 0,
      BASE_TIME,
      null,
    );
    await run(
      database,
      "INSERT INTO users (id, email_key, display_name, avatar_asset_id, bio, joined_at, updated_at) VALUES (?, ?, ?, NULL, '', ?, ?)",
      user.id,
      user.email,
      user.displayName,
      BASE_TIME,
      BASE_TIME,
    );
  }

  await run(
    database,
    "INSERT INTO tags (id, name, normalized_name, created_at) VALUES (?, ?, ?, ?)",
    E2E_TAG.id,
    E2E_TAG.name,
    E2E_TAG.normalizedName,
    BASE_TIME,
  );

  await insertPost(database, {
    ...E2E_POSTS.discussion,
    markdown: "这里用于验证普通回复、通知和失败恢复。",
  });
  await insertPost(database, {
    ...E2E_POSTS.annotationCreation,
    markdown:
      "第一段包含可以创建同段批注的稳定文字。\n\n第二段开始跨段选择。\n\n第三段结束跨段选择。",
  });

  await insertAnnotatedPost(database, {
    post: E2E_POSTS.annotationActivation,
    annotationId: E2E_ANNOTATIONS.activation,
    selectedText: "可以点击的批注文本",
    content: "这是一条用于验证点击、键盘和响应式阅读的批注。",
  });
  await insertAnnotatedPost(database, {
    post: E2E_POSTS.annotationDiscussion,
    annotationId: E2E_ANNOTATIONS.discussion,
    selectedText: "用于讨论的批注文本",
    content: "这是一条用于验证批注回复和通知的批注。",
  });
  await insertAnnotatedPost(database, {
    post: E2E_POSTS.annotationEdit,
    annotationId: E2E_ANNOTATIONS.edit,
    selectedText: "受端点保护的批注文本",
    content: "这是一条用于验证正文编辑保护的批注。",
  });
  await run(
    database,
    "INSERT INTO annotation_replies (id, annotation_id, author_id, reply_to_user_id, reply_to_reply_id, content_markdown, submission_key, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
    E2E_ANNOTATION_REPLIES.discussion,
    E2E_ANNOTATIONS.discussion,
    E2E_USERS.author.id,
    E2E_USERS.reader.id,
    "已有的一条批注回复。",
    uuid(553),
    BASE_TIME + 20_000,
  );

  await insertImportedPost(database);
  await insertPost(database, {
    ...E2E_POSTS.deleteRestore,
    markdown: "作者删除后这段正文不得泄露，但其他成员的讨论应保留。",
  });
  await insertPost(database, {
    ...E2E_POSTS.hidden,
    markdown: "这是管理员筛选、隐藏和恢复使用的内容。",
    hiddenAt: BASE_TIME + 40_000,
    hiddenByUserId: E2E_USERS.admin.id,
    hiddenReason: "测试预置隐藏状态",
  });
  await insertRevisionPost(database);
  await insertPost(database, {
    ...E2E_POSTS.conflict,
    markdown: "两个编辑页面从这份正文开始。",
  });
  await insertPost(database, {
    ...E2E_POSTS.purge,
    markdown: "这是只在本地一次性数据库中永久删除的内容。",
  });
  await insertPost(database, {
    ...E2E_POSTS.edit,
    markdown: "这是作者将通过浏览器修改的原始正文。",
  });
  await insertPost(database, {
    ...E2E_POSTS.replyFailure,
    markdown: "这是用于验证失败后输入不会丢失的帖子。",
  });
  await insertPost(database, {
    ...E2E_POSTS.bulkOne,
    markdown: "这是第一条批量管理目标。",
  });
  await insertPost(database, {
    ...E2E_POSTS.bulkTwo,
    markdown: "这是第二条批量管理目标。",
  });

  await insertReply(database, {
    id: uuid(403),
    postId: E2E_POSTS.deleteRestore.id,
    authorId: E2E_USERS.reader.id,
    markdown: "帖子删除后仍然保留的其他成员讨论。",
    publishedAt: BASE_TIME + 50_000,
  });

  for (const item of E2E_DISCOVERY_POSTS) {
    const publishedAt = BASE_TIME - item.index * 60_000;
    await insertPost(database, {
      ...item,
      markdown: `这是 ${item.title} 的可搜索正文，包含统一关键词“分页检索”。`,
      publishedAt,
    });
    await run(
      database,
      "INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)",
      item.id,
      E2E_TAG.id,
    );
  }
}

async function insertPost(database: D1Database, input: SeedPost): Promise<void> {
  const authorId = input.authorId ?? E2E_USERS.author.id;
  const publishedAt = input.publishedAt ?? BASE_TIME;
  await run(
    database,
    `INSERT INTO posts (
      id, author_id, creation_submission_key, title, markdown, search_text,
      current_revision_id, published_at, edited_at, last_activity_at,
      deleted_at, deleted_by_user_id, hidden_at, hidden_by_user_id, hidden_reason
    ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    authorId,
    input.title,
    input.markdown,
    `${input.title}\n${input.markdown}`,
    publishedAt,
    input.editedAt ?? null,
    publishedAt,
    input.deletedAt ?? null,
    input.deletedByUserId ?? null,
    input.hiddenAt ?? null,
    input.hiddenByUserId ?? null,
    input.hiddenReason ?? null,
  );
  await run(
    database,
    "INSERT INTO post_revisions (id, post_id, revision_number, kind, title, markdown, created_at, created_by_user_id, restore_source_revision_id) VALUES (?, ?, 1, 'CONTENT_EDIT', ?, ?, ?, ?, NULL)",
    input.revisionId,
    input.id,
    input.title,
    input.markdown,
    publishedAt,
    authorId,
  );
  await run(
    database,
    "UPDATE posts SET current_revision_id = ? WHERE id = ?",
    input.revisionId,
    input.id,
  );
}

async function insertReply(
  database: D1Database,
  input: {
    id: string;
    postId: string;
    authorId: string;
    markdown: string;
    publishedAt: number;
    rootReplyId?: string | null;
    replyToReplyId?: string | null;
    replyToUserId?: string | null;
  },
): Promise<void> {
  await run(
    database,
    "INSERT INTO replies (id, post_id, author_id, root_reply_id, reply_to_reply_id, reply_to_user_id, submission_key, markdown, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    input.id,
    input.postId,
    input.authorId,
    input.rootReplyId ?? null,
    input.replyToReplyId ?? null,
    input.replyToUserId ?? null,
    uuid(Number.parseInt(input.id.slice(-6), 16) + 5_000),
    input.markdown,
    input.publishedAt,
  );
  await run(
    database,
    "UPDATE posts SET last_activity_at = ? WHERE id = ?",
    input.publishedAt,
    input.postId,
  );
}

async function insertNativeAnnotation(
  database: D1Database,
  input: {
    id: string;
    postId: string;
    revisionId: string;
    authorId: string;
    selectedText: string;
    content: string;
    createdAt: number;
  },
): Promise<void> {
  await run(
    database,
    "INSERT INTO annotations (id, post_id, author_id, content_markdown, original_selected_text, created_at, created_on_revision_id, submission_key, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NATIVE')",
    input.id,
    input.postId,
    input.authorId,
    input.content,
    input.selectedText,
    input.createdAt,
    input.revisionId,
    uuid(Number.parseInt(input.id.slice(-6), 16) + 6_000),
  );
  await run(
    database,
    "INSERT INTO post_annotation_anchors (post_id, annotation_id) VALUES (?, ?)",
    input.postId,
    input.id,
  );
  await run(
    database,
    "INSERT INTO revision_annotation_states (revision_id, annotation_id) VALUES (?, ?)",
    input.revisionId,
    input.id,
  );
}

async function insertAnnotatedPost(
  database: D1Database,
  input: {
    post: { id: string; revisionId: string; title: string };
    annotationId: string;
    selectedText: string;
    content: string;
  },
): Promise<void> {
  const markdown = `这一段包含 :annotation[${input.selectedText}]{#${input.annotationId}}，后面还有普通正文。`;
  await insertPost(database, { ...input.post, markdown });
  await insertNativeAnnotation(database, {
    id: input.annotationId,
    postId: input.post.id,
    revisionId: input.post.revisionId,
    authorId: E2E_USERS.reader.id,
    selectedText: input.selectedText,
    content: input.content,
    createdAt: BASE_TIME + 10_000,
  });
}

async function insertImportedPost(database: D1Database): Promise<void> {
  const markdown = `导入正文保留普通段落。\n\n这里有 :annotation[导入批注范围]{#${E2E_ANNOTATIONS.imported}}，可以继续编辑其他文字。`;
  await insertPost(database, { ...E2E_POSTS.imported, markdown });
  await run(
    database,
    "INSERT INTO import_batches (id, importer_user_id, source_filename, source_sha256, post_id, revision_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    E2E_IMPORT_BATCH,
    E2E_USERS.author.id,
    "测试导入.docx",
    "a".repeat(64),
    E2E_POSTS.imported.id,
    E2E_POSTS.imported.revisionId,
    BASE_TIME,
  );
  await run(
    database,
    `INSERT INTO annotations (
      id, post_id, author_id, content_markdown, original_selected_text, created_at,
      created_on_revision_id, submission_key, source_type, source_author_name,
      source_initials, source_created_at, source_comment_id, source_document_order,
      source_resolved, import_batch_id, imported_by_user_id, attributed_user_id
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'DOCX_IMPORT', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    E2E_ANNOTATIONS.imported,
    E2E_POSTS.imported.id,
    "Word 中的批注内容。",
    "导入批注范围",
    BASE_TIME,
    E2E_POSTS.imported.revisionId,
    `docx:${E2E_IMPORT_BATCH}:comment-1`,
    "Word 作者",
    "WA",
    BASE_TIME,
    "comment-1",
    0,
    0,
    E2E_IMPORT_BATCH,
    E2E_USERS.author.id,
  );
  await run(
    database,
    "INSERT INTO post_annotation_anchors (post_id, annotation_id) VALUES (?, ?)",
    E2E_POSTS.imported.id,
    E2E_ANNOTATIONS.imported,
  );
  await run(
    database,
    "INSERT INTO revision_annotation_states (revision_id, annotation_id) VALUES (?, ?)",
    E2E_POSTS.imported.revisionId,
    E2E_ANNOTATIONS.imported,
  );
  await run(
    database,
    `INSERT INTO annotation_replies (
      id, annotation_id, author_id, reply_to_user_id, reply_to_reply_id,
      content_markdown, submission_key, created_at, source_type, source_author_name,
      source_initials, source_created_at, source_comment_id, source_document_order,
      source_resolved, import_batch_id, imported_by_user_id, attributed_user_id
    ) VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, 'DOCX_IMPORT', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    E2E_ANNOTATION_REPLIES.imported,
    E2E_ANNOTATIONS.imported,
    "Word 中的一条批注回复。",
    `docx:${E2E_IMPORT_BATCH}:reply-1`,
    BASE_TIME + 1_000,
    "Word 回复者",
    "WR",
    BASE_TIME + 1_000,
    "reply-1",
    1,
    0,
    E2E_IMPORT_BATCH,
    E2E_USERS.author.id,
  );
  await run(
    database,
    "INSERT INTO revision_imported_reply_states (revision_id, annotation_reply_id) VALUES (?, ?)",
    E2E_POSTS.imported.revisionId,
    E2E_ANNOTATION_REPLIES.imported,
  );
}

async function insertRevisionPost(database: D1Database): Promise<void> {
  await insertPost(database, {
    ...E2E_POSTS.revision,
    markdown: "历史版本正文。",
  });
  const currentRevisionId = uuid(1218);
  await run(
    database,
    "INSERT INTO post_revisions (id, post_id, revision_number, kind, title, markdown, created_at, created_by_user_id, restore_source_revision_id) VALUES (?, ?, 2, 'CONTENT_EDIT', ?, ?, ?, ?, NULL)",
    currentRevisionId,
    E2E_POSTS.revision.id,
    E2E_POSTS.revision.title,
    "当前版本正文。",
    BASE_TIME + 80_000,
    E2E_USERS.author.id,
  );
  await run(
    database,
    "UPDATE posts SET markdown = ?, search_text = ?, current_revision_id = ?, edited_at = ? WHERE id = ?",
    "当前版本正文。",
    `${E2E_POSTS.revision.title}\n当前版本正文。`,
    currentRevisionId,
    BASE_TIME + 80_000,
    E2E_POSTS.revision.id,
  );
}

async function run(database: D1Database, sql: string, ...values: unknown[]): Promise<void> {
  const result = await database
    .prepare(sql)
    .bind(...values)
    .run();
  if (!result.success) throw new Error(`E2E seed failed: ${sql}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stateDirectory = process.env.E2E_STATE_DIR;
  if (!stateDirectory) throw new Error("E2E_STATE_DIR is required");
  await prepareE2EState(stateDirectory);
}
