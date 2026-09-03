export type DocxImportErrorCode =
  | "INVALID_EXTENSION"
  | "FILE_SIZE_LIMIT"
  | "OLE_DOCUMENT_UNSUPPORTED"
  | "ZIP_SIGNATURE_INVALID"
  | "ZIP_INVALID"
  | "ZIP_AMBIGUOUS"
  | "ZIP_ENCRYPTED_ENTRY"
  | "ZIP_SYMLINK_ENTRY"
  | "ZIP_PATH_UNSAFE"
  | "ZIP_DUPLICATE_ENTRY"
  | "ZIP_ENTRY_LIMIT"
  | "ZIP_UNCOMPRESSED_LIMIT"
  | "ZIP_RATIO_LIMIT"
  | "ZIP_ENTRY_NOT_FOUND"
  | "ZIP_ENTRY_READ_FAILED"
  | "ZIP_ENTRY_SIZE_MISMATCH"
  | "REQUIRED_PART_MISSING"
  | "XML_PART_SIZE_LIMIT"
  | "XML_DTD_FORBIDDEN"
  | "XML_DEPTH_LIMIT"
  | "XML_MALFORMED"
  | "XML_ENCODING_INVALID"
  | "COMMENT_LIMIT"
  | "COMMENT_ID_DUPLICATE"
  | "IMAGE_COUNT_LIMIT"
  | "IMAGE_SIZE_LIMIT"
  | "MARKDOWN_SIZE_LIMIT"
  | "PACKAGE_CLOSED"
  | "PARSE_ABORTED"
  | "PARSE_TIMEOUT"
  | "PARSE_FAILED"
  | "PREVIEW_DATA_INVALID";

export class DocxImportError extends Error {
  readonly code: DocxImportErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: DocxImportErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocxImportError";
    this.code = code;
    this.details = details;
  }
}

export type ImportWarningCode =
  | "HEADING_LEVEL_CLAMPED"
  | "LIST_DEPTH_CLAMPED"
  | "VISUAL_FORMATTING_DROPPED"
  | "HYPERLINK_UNSAFE_DROPPED"
  | "TOC_SKIPPED"
  | "TRACK_CHANGES_FLATTENED"
  | "TABLE_HEADER_SYNTHESIZED"
  | "TABLE_CELL_FLATTENED"
  | "TABLE_MERGED_CELLS_FLATTENED"
  | "FLOATING_IMAGE_FLATTENED"
  | "IMAGE_FORMAT_UNSUPPORTED"
  | "TEXTBOX_FLATTENED"
  | "EQUATION_SKIPPED"
  | "SHAPE_CONTENT_SKIPPED"
  | "NOTES_FLATTENED_TO_APPENDIX"
  | "ANNOTATION_EMPTY_RANGE"
  | "ANNOTATION_CROSS_BLOCK"
  | "ANNOTATION_NON_TEXT_RANGE"
  | "ANNOTATION_TABLE_UNSUPPORTED"
  | "ANNOTATION_OVERLAP_SKIPPED"
  | "ANNOTATION_ORPHAN_DEFINITION"
  | "ANNOTATION_THREAD_SKIPPED";

export interface ImportWarning {
  code: ImportWarningCode;
  severity: "info" | "warning" | "error";
  sourceRef?: string;
  count?: number;
  payload?: Readonly<Record<string, unknown>>;
}

export type InlineMark = "strong" | "em" | "strike" | "code";

export interface InlineSegment {
  text: string;
  marks: InlineMark[];
  link?: string;
  commentIds: string[];
  synthetic?: "noteReference" | "equation";
}

interface ImportBlockBase {
  id: string;
}

export interface ParagraphBlock extends ImportBlockBase {
  type: "paragraph";
  segments: InlineSegment[];
}

export interface HeadingBlock extends ImportBlockBase {
  type: "heading";
  level: 1 | 2 | 3 | 4;
  segments: InlineSegment[];
}

export interface QuoteBlock extends ImportBlockBase {
  type: "quote";
  segments: InlineSegment[];
}

export interface ImportListItem {
  id: string;
  segments: InlineSegment[];
  children: ListBlock[];
}

export interface ListBlock extends ImportBlockBase {
  type: "list";
  ordered: boolean;
  start?: number;
  depth: 0 | 1 | 2;
  items: ImportListItem[];
}

export interface ImportTableCell {
  segments: InlineSegment[];
}

export interface ImportTableRow {
  cells: ImportTableCell[];
}

export interface TableBlock extends ImportBlockBase {
  type: "table";
  header: ImportTableRow;
  rows: ImportTableRow[];
}

export interface ImageBlock extends ImportBlockBase {
  type: "image";
  assetId: string;
  alt: string;
}

export interface NotesAppendixBlock extends ImportBlockBase {
  type: "notesAppendix";
  title: string;
  notes: Array<{ number: number; segments: InlineSegment[] }>;
}

export type ImportBlock =
  | ParagraphBlock
  | HeadingBlock
  | QuoteBlock
  | ListBlock
  | TableBlock
  | ImageBlock
  | NotesAppendixBlock;

export interface ImportAsset {
  id: string;
  filename: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  bytes: Uint8Array;
  alt: string;
  sourceRelationshipId: string;
  floating: boolean;
}

export type ImportAssetCandidate = ImportAsset;

export interface ImportedReply {
  replyId: string;
  sourceCommentId: string;
  parentSourceCommentId: string;
  sourceAuthorName: string;
  sourceInitials?: string;
  sourceCreatedAt?: string;
  sourceDocumentOrder: number;
  sourceResolved: boolean;
  attributedUserId?: string;
  bodyMarkdown: string;
}

export interface ImportedThread {
  annotationId: string;
  sourceCommentId: string;
  blockId: string;
  endBlockId?: string;
  blockLocalStart: number;
  blockLocalEnd: number;
  sourceAuthorName: string;
  sourceInitials?: string;
  sourceCreatedAt?: string;
  sourceDocumentOrder: number;
  sourceResolved: boolean;
  attributedUserId?: string;
  bodyMarkdown: string;
  replies: ImportedReply[];
}

export interface SkippedThread {
  sourceCommentId: string;
  sourceAuthorName?: string;
  sourceDocumentOrder: number;
  warning: ImportWarning;
}

export interface ParsedDocx {
  version: 1;
  source: {
    filename: string;
    producer?: string;
  };
  suggestedTitle: string;
  blocks: ImportBlock[];
  assets: ImportAsset[];
  threads: ImportedThread[];
  skippedThreads: SkippedThread[];
  warnings: ImportWarning[];
  canonicalMarkdown: string;
}

export interface DocxImportIR extends ParsedDocx {
  importBatchId: string;
  source: ParsedDocx["source"] & { sha256: string };
}

export interface DocxPreviewAsset {
  assetId: string;
  temporaryUrl: string;
  filename: string;
  mimeType: ImportAsset["mimeType"];
}

export interface DocxPreviewRecord {
  version: 1;
  importBatchId: string;
  title?: string;
  createdAt: string;
  expiresAt: string;
  ir: DocxImportIR;
  canonicalMarkdown: string;
  temporaryAssets: DocxPreviewAsset[];
  authorMappings: Readonly<Record<string, string>>;
}
