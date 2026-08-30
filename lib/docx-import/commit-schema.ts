import { z } from "zod";

import type { CommitSafeImportPreview } from "./preview-validation.ts";
import type { ImportBlock, ListBlock } from "./types.ts";

const uuidV4 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const annotationId = z.string().regex(/^ann_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const sourceId = z.string().min(1).max(200);
const sourceName = z.string().min(1).max(300);
const isoDate = z.string().datetime({ offset: true });
const imageMime = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const warningCode = z.enum([
  "HEADING_LEVEL_CLAMPED", "LIST_DEPTH_CLAMPED", "VISUAL_FORMATTING_DROPPED",
  "HYPERLINK_UNSAFE_DROPPED", "TOC_SKIPPED", "TRACK_CHANGES_FLATTENED",
  "TABLE_HEADER_SYNTHESIZED", "TABLE_CELL_FLATTENED", "TABLE_MERGED_CELLS_FLATTENED",
  "FLOATING_IMAGE_FLATTENED", "IMAGE_FORMAT_UNSUPPORTED", "TEXTBOX_FLATTENED",
  "EQUATION_SKIPPED", "SHAPE_CONTENT_SKIPPED", "NOTES_FLATTENED_TO_APPENDIX",
  "ANNOTATION_EMPTY_RANGE", "ANNOTATION_CROSS_BLOCK", "ANNOTATION_NON_TEXT_RANGE",
  "ANNOTATION_TABLE_UNSUPPORTED", "ANNOTATION_OVERLAP_SKIPPED", "ANNOTATION_ORPHAN_DEFINITION",
  "ANNOTATION_THREAD_SKIPPED",
]);

const inlineSegment = z.strictObject({
  text: z.string().max(1_500_000),
  marks: z.array(z.enum(["strong", "em", "strike", "code"])).max(4),
  link: z.string().max(4_096).optional(),
  commentIds: z.array(sourceId).max(500),
  synthetic: z.enum(["noteReference", "equation"]).optional(),
});

const listBlock: z.ZodType<ListBlock> = z.lazy(() => z.strictObject({
  id: sourceId,
  type: z.literal("list"),
  ordered: z.boolean(),
  start: z.number().int().positive().optional(),
  depth: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  items: z.array(z.strictObject({
    id: sourceId,
    segments: z.array(inlineSegment).max(10_000),
    children: z.array(listBlock).max(1_000),
  })).max(10_000),
}));

const block: z.ZodType<ImportBlock> = z.union([
  z.strictObject({ id: sourceId, type: z.literal("paragraph"), segments: z.array(inlineSegment).max(10_000) }),
  z.strictObject({ id: sourceId, type: z.literal("heading"), level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), segments: z.array(inlineSegment).max(10_000) }),
  z.strictObject({ id: sourceId, type: z.literal("quote"), segments: z.array(inlineSegment).max(10_000) }),
  listBlock,
  z.strictObject({
    id: sourceId,
    type: z.literal("table"),
    header: z.strictObject({ cells: z.array(z.strictObject({ segments: z.array(inlineSegment).max(10_000) })).max(1_000) }),
    rows: z.array(z.strictObject({ cells: z.array(z.strictObject({ segments: z.array(inlineSegment).max(10_000) })).max(1_000) })).max(10_000),
  }),
  z.strictObject({ id: sourceId, type: z.literal("image"), assetId: sourceId, alt: z.string().max(2_000) }),
  z.strictObject({
    id: sourceId,
    type: z.literal("notesAppendix"),
    title: z.string().min(1).max(500),
    notes: z.array(z.strictObject({ number: z.number().int().positive(), segments: z.array(inlineSegment).max(10_000) })).max(10_000),
  }),
]);

const importedReply = z.strictObject({
  replyId: uuidV4,
  authorId: z.string().nullable().optional(),
  sourceCommentId: sourceId,
  parentSourceCommentId: sourceId,
  sourceAuthorName: sourceName,
  sourceInitials: z.string().max(100).optional(),
  sourceCreatedAt: isoDate.optional(),
  sourceDocumentOrder: z.number().int().nonnegative(),
  sourceResolved: z.boolean(),
  attributedUserId: uuidV4.optional(),
  bodyMarkdown: z.string().min(1).max(10_000),
});

const importedThread = z.strictObject({
  annotationId,
  authorId: z.string().nullable().optional(),
  sourceCommentId: sourceId,
  blockId: sourceId,
  blockLocalStart: z.number().int().nonnegative(),
  blockLocalEnd: z.number().int().nonnegative(),
  sourceAuthorName: sourceName,
  sourceInitials: z.string().max(100).optional(),
  sourceCreatedAt: isoDate.optional(),
  sourceDocumentOrder: z.number().int().nonnegative(),
  sourceResolved: z.boolean(),
  attributedUserId: uuidV4.optional(),
  bodyMarkdown: z.string().min(1).max(10_000),
  replies: z.array(importedReply).max(500),
});

const warning = z.strictObject({
  code: warningCode,
  severity: z.enum(["info", "warning", "error"]),
  sourceRef: z.string().max(500).optional(),
  count: z.number().int().positive().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const source = z.strictObject({
  filename: z.string().min(1).max(255),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const DocxImportCommitSchema = z.strictObject({
  version: z.literal(1),
  importBatchId: uuidV4,
  source,
  title: z.string().max(500),
  markdown: z.string().max(1_500_000),
  ir: z.strictObject({
    version: z.literal(1),
    importBatchId: uuidV4,
    source: source.extend({ producer: z.string().max(500).optional() }),
    suggestedTitle: z.string().max(500),
    blocks: z.array(block).max(10_000),
    assets: z.array(z.strictObject({
      id: sourceId,
      filename: z.string().min(1).max(255),
      mimeType: imageMime,
      alt: z.string().max(2_000),
      sourceRelationshipId: sourceId,
      floating: z.boolean(),
    })).max(200),
    threads: z.array(importedThread).max(500),
    skippedThreads: z.array(z.strictObject({
      sourceCommentId: sourceId,
      sourceAuthorName: sourceName.optional(),
      sourceDocumentOrder: z.number().int().nonnegative(),
      warning,
    })).max(500),
    warnings: z.array(warning).max(10_000),
    canonicalMarkdown: z.string().max(1_500_000),
  }),
  temporaryAssets: z.array(z.strictObject({
    assetId: uuidV4,
    temporaryUrl: z.string().max(500),
    filename: z.string().min(1).max(255),
    mimeType: imageMime,
  })).max(200),
  authorMappings: z.record(z.string().min(1).max(300), uuidV4),
});

export type DocxImportCommitInput = z.infer<typeof DocxImportCommitSchema>;

export function toDocxImportCommitPayload(preview: CommitSafeImportPreview): DocxImportCommitInput {
  return {
    version: 1,
    importBatchId: preview.importBatchId,
    source: {
      filename: preview.ir.source.filename,
      sha256: preview.ir.source.sha256,
    },
    title: preview.title,
    markdown: preview.markdown,
    ir: {
      ...preview.ir,
      assets: preview.ir.assets.map((asset) => ({
        id: asset.id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        alt: asset.alt,
        sourceRelationshipId: asset.sourceRelationshipId,
        floating: asset.floating,
      })),
      threads: preview.ir.threads.map((thread) => ({
        ...thread,
        authorId: null,
        replies: thread.replies.map((reply) => ({ ...reply, authorId: null })),
      })),
    },
    temporaryAssets: preview.temporaryAssets.map((asset) => ({ ...asset })),
    authorMappings: { ...preview.authorMappings },
  };
}
