import { validateAnnotationContent } from "../annotations/policy.ts";
import { parseAnnotationMarkdown } from "../annotations/markdown.ts";
import { markdownToPlainText } from "../markdown/render.ts";
import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import {
  DocxImportCommitSchema,
  type DocxImportCommitInput,
} from "./commit-schema.ts";

const ROW_CHUNK_SIZE = 32;
const encoder = new TextEncoder();

export type SqlValue = string | number | null;
export type D1StatementPlan = {
  sql: string;
  params: SqlValue[];
  kind: string;
  rowCount: number;
};

export class DocxImportValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DocxImportValidationError";
    this.code = code;
  }
}

type AnchorRange = {
  annotationId: string;
  blockOrdinal: number;
  start: number;
  end: number;
  selectedText: string;
};

export type ValidatedDocxImportCommit = DocxImportCommitInput & {
  title: string;
  markdown: string;
  anchorRanges: AnchorRange[];
  assetIds: string[];
  attributedUserIds: string[];
};

export type CommitAssetContext = {
  id: string;
  ownerId: string;
  kind: "avatar" | "image" | "attachment";
  mimeType: string;
  status: "temporary" | "permanent";
  deletedAt: number | Date | null;
};

export type DocxImportCommitContext = {
  importerUserId: string;
  postId: string;
  revisionId: string;
  eventId: string;
  payloadHash: string;
  now: Date;
  assets: CommitAssetContext[];
};

export type DocxImportCommitPlan = {
  statements: D1StatementPlan[];
  rowChunks: Array<{ kind: string; rowCount: number }>;
  activityCount: number;
  annotationActivityCount: number;
  notificationCount: number;
};

export function validateDocxImportCommitPayload(input: unknown): ValidatedDocxImportCommit {
  const parsed = DocxImportCommitSchema.safeParse(input);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.map(String).join(".") ?? "";
    if (/threads\.\d+\.annotationId$/.test(path)) fail("ANNOTATION_ID_INVALID");
    if (/replies\.\d+\.replyId$/.test(path)) fail("REPLY_ID_INVALID");
    fail("COMMIT_SCHEMA_INVALID");
  }
  const payload = parsed.data;
  const title = payload.title.trim();
  const markdown = payload.markdown.trim();
  if (!title) fail("TITLE_REQUIRED");
  if (Array.from(title).length > 120) fail("TITLE_TOO_LONG");
  if (!markdown) fail("MARKDOWN_REQUIRED");
  if (encoder.encode(markdown).byteLength > DOCX_IMPORT_LIMITS.markdownUtf8Bytes) fail("MARKDOWN_SIZE_LIMIT");
  if (!payload.source.filename.toLocaleLowerCase("en-US").endsWith(".docx")) fail("SOURCE_FILENAME_INVALID");
  if (
    payload.importBatchId !== payload.ir.importBatchId
    || payload.source.filename !== payload.ir.source.filename
    || payload.source.sha256 !== payload.ir.source.sha256
    || markdown !== payload.ir.canonicalMarkdown.trim()
  ) fail("IR_ENVELOPE_MISMATCH");
  if (
    payload.ir.warnings.some((warning) => warning.severity === "error")
    || payload.ir.skippedThreads.some((thread) => thread.warning.severity === "error")
  ) fail("IMPORT_WARNING_ERROR");

  validateBlocks(payload);
  validateImportedIdentities(payload);
  const selectedTextById = validateSourceRanges(payload);
  const anchorRanges = validateMarkdown(payload, markdown, selectedTextById);
  const assetIds = validateAssets(payload);
  const attributedUserIds = validateMappings(payload);

  return { ...payload, title, markdown, anchorRanges, assetIds, attributedUserIds };
}

export function planDocxImportCommit(
  validated: ValidatedDocxImportCommit,
  context: DocxImportCommitContext,
): DocxImportCommitPlan {
  const now = context.now.getTime();
  const statements: D1StatementPlan[] = [];
  const rowChunks: Array<{ kind: string; rowCount: number }> = [];
  const addRows = (kind: string, table: string, columns: string[], rows: SqlValue[][]) => {
    for (let index = 0; index < rows.length; index += ROW_CHUNK_SIZE) {
      const chunk = rows.slice(index, index + ROW_CHUNK_SIZE);
      statements.push({
        kind,
        rowCount: chunk.length,
        sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ")}`,
        params: chunk.flat(),
      });
      rowChunks.push({ kind, rowCount: chunk.length });
    }
  };

  addRows("post", "posts", [
    "id", "author_id", "title", "markdown", "search_text", "current_revision_id", "published_at",
    "edited_at", "last_activity_at", "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id", "hidden_reason",
  ], [[
    context.postId, context.importerUserId, validated.title, validated.markdown,
    markdownToPlainText(validated.markdown), context.revisionId, now, null, now,
    null, null, null, null, null,
  ]]);
  addRows("revision", "post_revisions", [
    "id", "post_id", "revision_number", "kind", "title", "markdown", "created_at", "created_by_user_id", "restore_source_revision_id",
  ], [[context.revisionId, context.postId, 1, "CONTENT_EDIT", validated.title, validated.markdown, now, context.importerUserId, null]]);
  addRows("import-batch", "import_batches", [
    "id", "importer_user_id", "source_filename", "source_sha256", "post_id", "revision_id", "committed_at",
  ], [[validated.importBatchId, context.importerUserId, validated.source.filename, validated.source.sha256, context.postId, context.revisionId, now]]);

  const assetById = new Map(context.assets.map((asset) => [asset.id, asset]));
  for (const manifest of validated.temporaryAssets) {
    const asset = assetById.get(manifest.assetId);
    if (!asset) fail("ASSET_NOT_CLAIMABLE");
    statements.push({
      kind: "asset-claim",
      rowCount: 1,
      sql: "UPDATE assets SET post_id = ?, status = CASE WHEN owner_id = ? AND status = 'temporary' AND kind = 'image' AND mime_type = ? AND deleted_at IS NULL THEN 'permanent' ELSE NULL END, bound_at = ?, expires_at = NULL WHERE id = ?",
      params: [context.postId, context.importerUserId, manifest.mimeType, now, manifest.assetId],
    });
    rowChunks.push({ kind: "asset-claim", rowCount: 1 });
  }
  const assetRows = validated.assetIds.map((assetId) => [assetId] as const);
  addRows("post-assets", "post_asset_refs", ["post_id", "asset_id", "usage"], assetRows.map(([assetId]) => [context.postId, assetId, "inline"]));
  addRows("revision-assets", "revision_asset_refs", ["revision_id", "asset_id", "usage"], assetRows.map(([assetId]) => [context.revisionId, assetId, "inline"]));

  const roots = validated.ir.threads;
  addRows("annotations", "annotations", [
    "id", "post_id", "author_id", "content_markdown", "original_selected_text", "created_at", "created_on_revision_id", "submission_key",
    "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id", "hidden_reason", "source_type", "source_author_name",
    "source_initials", "source_created_at", "source_comment_id", "source_document_order", "source_resolved", "import_batch_id",
    "imported_by_user_id", "attributed_user_id",
  ], roots.map((root) => [
    root.annotationId, context.postId, null, root.bodyMarkdown.trim(), selectedTextFor(validated, root.annotationId), now,
    context.revisionId, `docx:${validated.importBatchId}:${root.sourceCommentId}`, null, null, null, null, null,
    "DOCX_IMPORT", root.sourceAuthorName, root.sourceInitials ?? null, sourceTime(root.sourceCreatedAt), root.sourceCommentId,
    root.sourceDocumentOrder, root.sourceResolved ? 1 : 0, validated.importBatchId, context.importerUserId,
    validated.authorMappings[root.sourceAuthorName] ?? root.attributedUserId ?? null,
  ]));

  const replyIdBySource = new Map(roots.flatMap((root) => root.replies.map((reply) => [reply.sourceCommentId, reply.replyId] as const)));
  const replyRows = roots.flatMap((root) => root.replies.map((reply) => [
    reply.replyId, root.annotationId, null, null,
    reply.parentSourceCommentId === root.sourceCommentId ? null : replyIdBySource.get(reply.parentSourceCommentId) ?? null,
    reply.bodyMarkdown.trim(), `docx:${validated.importBatchId}:${reply.sourceCommentId}`, now,
    null, null, null, null, null, "DOCX_IMPORT", reply.sourceAuthorName, reply.sourceInitials ?? null,
    sourceTime(reply.sourceCreatedAt), reply.sourceCommentId, reply.sourceDocumentOrder, reply.sourceResolved ? 1 : 0,
    validated.importBatchId, context.importerUserId, validated.authorMappings[reply.sourceAuthorName] ?? reply.attributedUserId ?? null,
  ]));
  addRows("annotation-replies", "annotation_replies", [
    "id", "annotation_id", "author_id", "reply_to_user_id", "reply_to_reply_id", "content_markdown", "submission_key", "created_at",
    "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id", "hidden_reason", "source_type", "source_author_name",
    "source_initials", "source_created_at", "source_comment_id", "source_document_order", "source_resolved", "import_batch_id",
    "imported_by_user_id", "attributed_user_id",
  ], replyRows);
  addRows("anchors", "post_annotation_anchors", ["post_id", "annotation_id"], roots.map((root) => [context.postId, root.annotationId]));
  addRows("annotation-snapshots", "revision_annotation_states", [
    "revision_id", "annotation_id", "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id",
  ], roots.map((root) => [context.revisionId, root.annotationId, null, null, null, null]));
  addRows("reply-snapshots", "revision_imported_reply_states", [
    "revision_id", "annotation_reply_id", "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id",
  ], replyRows.map((row) => [context.revisionId, row[0]!, null, null, null, null]));

  addRows("activity", "activity_events", [
    "id", "actor_user_id", "event_type", "post_id", "reply_id", "annotation_id", "annotation_reply_id", "root_reply_id",
    "reply_to_user_id", "metadata_json", "created_at", "invalidated_at",
  ], [[context.eventId, context.importerUserId, "POST_CREATED", context.postId, null, null, null, null, null, JSON.stringify({ docxImportPayloadHash: context.payloadHash }), now, null]]);

  const attributionCounts = new Map<string, number>();
  for (const item of roots.flatMap((root) => [root, ...root.replies])) {
    const recipient = validated.authorMappings[item.sourceAuthorName] ?? item.attributedUserId;
    if (recipient && recipient !== context.importerUserId) attributionCounts.set(recipient, (attributionCounts.get(recipient) ?? 0) + 1);
  }
  const notificationRows = [...attributionCounts].sort(([left], [right]) => left.localeCompare(right)).map(([recipient, commentCount]) => [
    `notification:${context.eventId}:${recipient}:docx-attribution-notice`, recipient, context.importerUserId, context.eventId,
    "DOCX_ATTRIBUTION_NOTICE", context.postId, null, null, null, JSON.stringify({ commentCount }), validated.importBatchId, now, null,
  ]);
  addRows("notifications", "notifications", [
    "id", "recipient_user_id", "actor_user_id", "event_id", "notification_type", "post_id", "reply_id", "annotation_id",
    "annotation_reply_id", "metadata_json", "import_batch_id", "created_at", "read_at",
  ], notificationRows);

  return {
    statements,
    rowChunks,
    activityCount: 1,
    annotationActivityCount: 0,
    notificationCount: notificationRows.length,
  };
}

function validateBlocks(payload: DocxImportCommitInput) {
  const ids = new Set<string>();
  const visit = (block: DocxImportCommitInput["ir"]["blocks"][number]) => {
    if (ids.has(block.id)) fail("BLOCK_ID_DUPLICATE");
    ids.add(block.id);
    if (block.type === "list") {
      for (const item of block.items) {
        if (ids.has(item.id)) fail("BLOCK_ID_DUPLICATE");
        ids.add(item.id);
        for (const child of item.children) visit(child);
      }
    }
  };
  payload.ir.blocks.forEach(visit);
}

function validateImportedIdentities(payload: DocxImportCommitInput) {
  const rootIds = new Set<string>();
  const replyIds = new Set<string>();
  const sourceIds = new Set<string>();
  let itemCount = 0;
  for (const root of payload.ir.threads) {
    itemCount += 1 + root.replies.length;
    if (root.authorId !== undefined && root.authorId !== null) fail("IMPORTED_AUTHOR_MUST_BE_NULL");
    if (rootIds.has(root.annotationId)) fail("ANNOTATION_ID_DUPLICATE");
    rootIds.add(root.annotationId);
    if (sourceIds.has(root.sourceCommentId)) fail("SOURCE_COMMENT_ID_DUPLICATE");
    sourceIds.add(root.sourceCommentId);
    validateAnnotationBody(root.bodyMarkdown);
    const threadSources = new Set([root.sourceCommentId, ...root.replies.map((reply) => reply.sourceCommentId)]);
    for (const reply of root.replies) {
      if (reply.authorId !== undefined && reply.authorId !== null) fail("IMPORTED_AUTHOR_MUST_BE_NULL");
      if (replyIds.has(reply.replyId)) fail("REPLY_ID_DUPLICATE");
      replyIds.add(reply.replyId);
      if (sourceIds.has(reply.sourceCommentId)) fail("SOURCE_COMMENT_ID_DUPLICATE");
      sourceIds.add(reply.sourceCommentId);
      if (!threadSources.has(reply.parentSourceCommentId) || reply.parentSourceCommentId === reply.sourceCommentId) fail("REPLY_PARENT_INVALID");
      validateAnnotationBody(reply.bodyMarkdown);
    }
    for (const reply of root.replies) {
      const bySource = new Map(root.replies.map((item) => [item.sourceCommentId, item]));
      const seen = new Set([reply.sourceCommentId]);
      let parent = reply.parentSourceCommentId;
      while (parent !== root.sourceCommentId) {
        if (seen.has(parent)) fail("REPLY_PARENT_INVALID");
        seen.add(parent);
        const parentReply = bySource.get(parent);
        if (!parentReply || parentReply.sourceDocumentOrder >= reply.sourceDocumentOrder) fail("REPLY_PARENT_INVALID");
        parent = parentReply.parentSourceCommentId;
      }
    }
  }
  if (itemCount > DOCX_IMPORT_LIMITS.commentsAndReplies) fail("COMMENT_LIMIT");
}

function validateSourceRanges(payload: DocxImportCommitInput): Map<string, string> {
  const selected = new Map<string, string>();
  const byBlock = new Map<string, typeof payload.ir.threads>();
  for (const thread of payload.ir.threads) {
    const value = blockText(payload.ir.blocks, thread.blockId);
    if (value === null || thread.blockLocalStart >= thread.blockLocalEnd || thread.blockLocalEnd > value.length) fail("ANNOTATION_RANGE_INVALID");
    selected.set(thread.annotationId, value.slice(thread.blockLocalStart, thread.blockLocalEnd));
    const list = byBlock.get(thread.blockId) ?? [];
    list.push(thread);
    byBlock.set(thread.blockId, list);
  }
  for (const threads of byBlock.values()) {
    const ordered = [...threads].sort((left, right) => left.blockLocalStart - right.blockLocalStart
      || (right.blockLocalEnd - right.blockLocalStart) - (left.blockLocalEnd - left.blockLocalStart)
      || left.sourceCommentId.localeCompare(right.sourceCommentId));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.blockLocalStart < ordered[index - 1]!.blockLocalEnd) fail("ANNOTATION_OVERLAP");
    }
  }
  return selected;
}

type MarkdownNode = {
  type: string;
  name?: string;
  value?: string;
  alt?: string;
  url?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MarkdownNode[];
};

function validateMarkdown(payload: DocxImportCommitInput, markdown: string, selectedTextById: Map<string, string>): AnchorRange[] {
  let tree: MarkdownNode;
  try { tree = parseAnnotationMarkdown(markdown) as MarkdownNode; }
  catch { fail("PREVIEW_MARKDOWN_INVALID"); }
  const anchors: AnchorRange[] = [];
  let blockOrdinal = 0;
  const scanOwner = (owner: MarkdownNode, forbidden: boolean) => {
    let offset = 0;
    const scan = (node: MarkdownNode, nested: boolean) => {
      if (node.url && !safeUrl(node.url)) fail("UNSAFE_EXTERNAL_URL");
      if (node.type === "text" || node.type === "inlineCode") { offset += node.value?.length ?? 0; return; }
      if (node.type === "image") { offset += node.alt?.length ?? 0; return; }
      const directive = node.type === "textDirective" && node.name === "annotation";
      if (directive) {
        if (nested) fail("ANNOTATION_NESTED");
        if (forbidden) fail("ANNOTATION_CROSS_BLOCK");
        const id = node.attributes?.id;
        if (!id || !selectedTextById.has(id)) fail("ANNOTATION_ANCHOR_UNKNOWN");
        const start = offset;
        node.children?.forEach((child) => scan(child, true));
        const end = offset;
        const selectedText = selectedTextById.get(id)!;
        if (visibleText(node) !== selectedText || end - start !== selectedText.length) fail("ANNOTATION_TEXT_CHANGED");
        anchors.push({ annotationId: id, blockOrdinal, start, end, selectedText });
        return;
      }
      node.children?.forEach((child) => scan(child, nested));
    };
    scan(owner, false);
    blockOrdinal += 1;
  };
  const walkOwners = (node: MarkdownNode, insideOwner = false) => {
    if (!insideOwner && (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell")) {
      scanOwner(node, node.type === "tableCell");
      return;
    }
    node.children?.forEach((child) => walkOwners(child, insideOwner));
  };
  walkOwners(tree);
  const expected = new Set(selectedTextById.keys());
  const seen = new Set<string>();
  for (const anchor of anchors) {
    if (seen.has(anchor.annotationId)) fail("ANNOTATION_ANCHOR_DUPLICATE");
    seen.add(anchor.annotationId);
  }
  if ([...expected].some((id) => !seen.has(id))) fail("ANNOTATION_ANCHOR_MISSING");
  return anchors.sort((left, right) => left.blockOrdinal - right.blockOrdinal || left.start - right.start || (right.end - right.start) - (left.end - left.start) || left.annotationId.localeCompare(right.annotationId));
}

function validateAssets(payload: DocxImportCommitInput): string[] {
  if (payload.ir.assets.length !== payload.temporaryAssets.length) fail("ASSET_REFERENCE_INVALID");
  const irIds = new Set<string>();
  const manifestIds = new Set<string>();
  for (const [index, manifest] of payload.temporaryAssets.entries()) {
    const source = payload.ir.assets[index];
    if (!source || irIds.has(source.id) || manifestIds.has(manifest.assetId)) fail("ASSET_REFERENCE_INVALID");
    irIds.add(source.id);
    manifestIds.add(manifest.assetId);
    if (
      manifest.temporaryUrl !== `/api/assets/${manifest.assetId}`
      || source.filename !== manifest.filename
      || source.mimeType !== manifest.mimeType
    ) fail("ASSET_REFERENCE_INVALID");
  }
  const referenced = new Set<string>();
  const tree = parseAnnotationMarkdown(payload.markdown) as MarkdownNode;
  walk(tree, (node) => {
    if (node.url?.startsWith("/api/assets/")) referenced.add(node.url.slice("/api/assets/".length));
  });
  if (referenced.size !== manifestIds.size || [...referenced].some((id) => !manifestIds.has(id))) fail("ASSET_REFERENCE_INVALID");
  return [...referenced].sort();
}

function validateMappings(payload: DocxImportCommitInput): string[] {
  const authors = new Set(payload.ir.threads.flatMap((root) => [root.sourceAuthorName, ...root.replies.map((reply) => reply.sourceAuthorName)]));
  for (const [author, userId] of Object.entries(payload.authorMappings)) {
    if (!authors.has(author)) fail("AUTHOR_MAPPING_INVALID");
    for (const item of payload.ir.threads.flatMap((root) => [root, ...root.replies])) {
      if (item.sourceAuthorName === author && item.attributedUserId && item.attributedUserId !== userId) fail("AUTHOR_MAPPING_INVALID");
    }
  }
  for (const item of payload.ir.threads.flatMap((root) => [root, ...root.replies])) {
    if (item.attributedUserId && payload.authorMappings[item.sourceAuthorName] !== item.attributedUserId) fail("AUTHOR_MAPPING_INVALID");
  }
  return [...new Set(Object.values(payload.authorMappings))].sort();
}

function validateAnnotationBody(markdown: string) {
  try { validateAnnotationContent(markdown); }
  catch { fail("ANNOTATION_CONTENT_INVALID"); }
  const tree = parseAnnotationMarkdown(markdown) as MarkdownNode;
  walk(tree, (node) => { if (node.url && !safeUrl(node.url)) fail("UNSAFE_EXTERNAL_URL"); });
}

function safeUrl(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try { return ["http:", "https:", "mailto:"].includes(new URL(value, "https://invalid.local").protocol); }
  catch { return false; }
}

function selectedTextFor(validated: ValidatedDocxImportCommit, annotationId: string): string {
  const value = validated.anchorRanges.find((anchor) => anchor.annotationId === annotationId)?.selectedText;
  if (value === undefined) fail("ANNOTATION_ANCHOR_MISSING");
  return value;
}

function sourceTime(value?: string): number | null { return value ? Date.parse(value) : null; }

function blockText(blocks: DocxImportCommitInput["ir"]["blocks"], blockId: string): string | null {
  for (const block of blocks) {
    if (block.id === blockId && "segments" in block) return block.segments.map((segment) => segment.text).join("");
    if (block.type !== "list") continue;
    for (const item of block.items) {
      if (item.id === blockId) return item.segments.map((segment) => segment.text).join("");
      const nested = blockText(item.children, blockId);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function visibleText(node: MarkdownNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "image") return node.alt ?? "";
  return node.children?.map(visibleText).join("") ?? "";
}

function walk(node: MarkdownNode, callback: (node: MarkdownNode) => void) {
  callback(node);
  node.children?.forEach((child) => walk(child, callback));
}

function fail(code: string): never { throw new DocxImportValidationError(code); }
