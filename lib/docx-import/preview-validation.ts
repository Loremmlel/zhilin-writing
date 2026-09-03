import { parseAnnotationMarkdown } from "../annotations/markdown.ts";
import { validateCanonicalAnnotationDocument, type AnnotationInvariantIssueCode } from "../annotations/invariants.ts";
import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { importedThreadSelectedText, importedThreadSlices } from "./thread-range.ts";
import type {
  DocxImportIR,
  DocxPreviewRecord,
  ImportBlock,
} from "./types.ts";

export type ImportPreviewValidationCode =
  | "TITLE_REQUIRED"
  | "TITLE_TOO_LONG"
  | "MARKDOWN_REQUIRED"
  | "MARKDOWN_SIZE_LIMIT"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_MARKDOWN_INVALID"
  | "ANNOTATION_ANCHOR_MISSING"
  | "ANNOTATION_ANCHOR_UNKNOWN"
  | "ANNOTATION_ANCHOR_DUPLICATE"
  | "ANNOTATION_TEXT_CHANGED"
  | "ANNOTATION_NESTED"
  | "ANNOTATION_NON_TEXT_RANGE"
  | "ANNOTATION_CROSS_BLOCK"
  | "ANNOTATION_OVERLAP"
  | "UNSAFE_EXTERNAL_URL"
  | "IMPORT_WARNING_ERROR"
  | "ASSET_UPLOAD_MISSING"
  | "ASSET_REFERENCE_INVALID"
  | "AUTHOR_MAPPING_INVALID";

export type ImportPreviewValidationError = {
  code: ImportPreviewValidationCode;
  annotationId?: string;
  url?: string;
};

export type EditedImportPreview = DocxPreviewRecord & {
  title: string;
  markdown: string;
};

export type CommitSafeImportPreview = DocxPreviewRecord & {
  title: string;
  markdown: string;
  ir: DocxImportIR;
};

export type ImportPreviewValidationResult =
  | { ok: true; payload: CommitSafeImportPreview; errors: [] }
  | { ok: false; errors: ImportPreviewValidationError[] };

type PreviewNode = {
  type: string;
  name?: string;
  url?: string;
  value?: string;
  alt?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: PreviewNode[];
};

const encoder = new TextEncoder();

export function validateEditedImportPreview(
  preview: EditedImportPreview,
  now = Date.now(),
  validUserIds?: ReadonlySet<string>,
): ImportPreviewValidationResult {
  const title = preview.title.trim();
  const markdown = preview.markdown.trim();
  const authorMappings = normalizeAuthorMappings(preview.authorMappings);
  const errors: ImportPreviewValidationError[] = [];
  if (!title) errors.push({ code: "TITLE_REQUIRED" });
  else if (Array.from(title).length > 120) errors.push({ code: "TITLE_TOO_LONG" });
  if (!markdown) errors.push({ code: "MARKDOWN_REQUIRED" });
  if (encoder.encode(markdown).byteLength > DOCX_IMPORT_LIMITS.markdownUtf8Bytes) {
    errors.push({ code: "MARKDOWN_SIZE_LIMIT" });
  }
  if (!Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= now) {
    errors.push({ code: "PREVIEW_EXPIRED" });
  }
  if (
    preview.ir.warnings.some((warning) => warning.severity === "error")
    || preview.ir.skippedThreads.some((thread) => thread.warning.severity === "error")
  ) {
    errors.push({ code: "IMPORT_WARNING_ERROR" });
  }
  validateSourceRanges(preview.ir, errors);
  validateTemporaryAssets(preview, errors);
  validateAuthorMappings(preview.ir, authorMappings, validUserIds, errors);

  let tree: PreviewNode | null = null;
  try {
    tree = parseAnnotationMarkdown(markdown) as PreviewNode;
  } catch {
    errors.push({ code: "PREVIEW_MARKDOWN_INVALID" });
  }
  if (tree) validateMarkdownTree(tree, preview, errors);
  if (errors.length > 0) return { ok: false, errors: uniqueErrors(errors) };

  return {
    ok: true,
    errors: [],
    payload: {
      ...preview,
      title,
      markdown,
      authorMappings,
      canonicalMarkdown: markdown,
      ir: { ...preview.ir, canonicalMarkdown: markdown },
    },
  };
}

function validateAuthorMappings(
  ir: DocxImportIR,
  authorMappings: Readonly<Record<string, string>>,
  validUserIds: ReadonlySet<string> | undefined,
  errors: ImportPreviewValidationError[],
) {
  const authors = new Set(ir.threads.flatMap((thread) => [
    thread.sourceAuthorName,
    ...thread.replies.map((reply) => reply.sourceAuthorName),
  ]));
  if (Object.entries(authorMappings).some(([author, userId]) => (
    !authors.has(author) || (validUserIds ? !validUserIds.has(userId) : false)
  ))) {
    errors.push({ code: "AUTHOR_MAPPING_INVALID" });
  }
}

export function normalizeAuthorMappings(
  authorMappings: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(authorMappings).filter(([, userId]) => Boolean(userId)));
}

function validateTemporaryAssets(
  preview: EditedImportPreview,
  errors: ImportPreviewValidationError[],
) {
  if (preview.ir.assets.length > preview.temporaryAssets.length) {
    errors.push({ code: "ASSET_UPLOAD_MISSING" });
  }
  if (preview.ir.assets.length !== preview.temporaryAssets.length || preview.markdown.includes("docx-asset:")) {
    errors.push({ code: "ASSET_REFERENCE_INVALID" });
  }
  for (const [index, asset] of preview.temporaryAssets.entries()) {
    const source = preview.ir.assets[index];
    if (!asset.assetId || asset.temporaryUrl !== `/api/assets/${asset.assetId}` || !source || source.filename !== asset.filename || source.mimeType !== asset.mimeType) {
      errors.push({ code: "ASSET_REFERENCE_INVALID" });
    }
  }
}

function validateMarkdownTree(
  tree: PreviewNode,
  preview: EditedImportPreview,
  errors: ImportPreviewValidationError[],
) {
  const { ir } = preview;
  const expected = new Map(ir.threads.map((thread) => [thread.annotationId, thread]));
  const referencedAssets = new Set<string>();
  walk(tree, (node) => {
    if ((node.type === "link" || node.type === "image") && node.url && !isSafeUrl(node.url)) {
      errors.push({ code: "UNSAFE_EXTERNAL_URL", url: node.url });
    }
    if ((node.type === "link" || node.type === "image") && node.url?.startsWith("/api/assets/")) {
      referencedAssets.add(node.url);
    }
  });
  const issueCode: Record<AnnotationInvariantIssueCode, ImportPreviewValidationCode> = {
    DUPLICATE: "ANNOTATION_ANCHOR_DUPLICATE",
    EMPTY: "ANNOTATION_TEXT_CHANGED",
    MULTI_BLOCK: "ANNOTATION_CROSS_BLOCK",
    OVERLAP: "ANNOTATION_OVERLAP",
    NESTED: "ANNOTATION_NESTED",
    INVALID_BLOCK: "ANNOTATION_NON_TEXT_RANGE",
    UNKNOWN_ID: "ANNOTATION_ANCHOR_UNKNOWN",
    MISSING_ACTIVE_ID: "ANNOTATION_ANCHOR_MISSING",
  };
  const validation = validateCanonicalAnnotationDocument(preview.markdown, expected.keys());
  for (const issue of validation.issues) {
    errors.push({ code: issueCode[issue.code], annotationId: issue.annotationId ?? undefined });
  }
  for (const anchor of validation.anchors) {
    const thread = expected.get(anchor.annotationId);
    if (thread && anchor.text !== importedThreadSelectedText(ir.blocks, thread)) {
      errors.push({ code: "ANNOTATION_TEXT_CHANGED", annotationId: anchor.annotationId });
    }
  }
  const manifestAssets = new Set(preview.temporaryAssets.map((asset) => asset.temporaryUrl));
  if (
    referencedAssets.size !== manifestAssets.size
    || [...referencedAssets].some((url) => !manifestAssets.has(url))
  ) {
    errors.push({ code: "ASSET_REFERENCE_INVALID" });
  }
}

function validateSourceRanges(ir: DocxImportIR, errors: ImportPreviewValidationError[]) {
  const byBlock = new Map<string, Array<{ annotationId: string; from: number; to: number }>>();
  const annotationIds = new Set<string>();
  for (const thread of ir.threads) {
    if (annotationIds.has(thread.annotationId)) {
      errors.push({ code: "ANNOTATION_ANCHOR_DUPLICATE", annotationId: thread.annotationId });
    }
    annotationIds.add(thread.annotationId);
    const slices = importedThreadSlices(ir.blocks, thread);
    if (!slices) {
      errors.push({ code: "ANNOTATION_CROSS_BLOCK", annotationId: thread.annotationId });
      continue;
    }
    if (slices.some((slice) => slice.segments.some((segment) => segment.marks.includes("code")))) {
      errors.push({ code: "ANNOTATION_NON_TEXT_RANGE", annotationId: thread.annotationId });
    }
    for (const slice of slices) {
      const ranges = byBlock.get(slice.blockId) ?? [];
      ranges.push({ annotationId: thread.annotationId, from: slice.from, to: slice.to });
      byBlock.set(slice.blockId, ranges);
    }
  }
  for (const ranges of byBlock.values()) {
    const ordered = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.from < ordered[index - 1]!.to) {
        errors.push({ code: "ANNOTATION_OVERLAP", annotationId: ordered[index]!.annotationId });
      }
    }
  }
}

export function getImportedThreadSelectedText(
  blocks: ImportBlock[],
  blockId: string,
  start: number,
  end: number,
  endBlockId?: string,
): string {
  return importedThreadSelectedText(blocks, {
    blockId,
    endBlockId,
    blockLocalStart: start,
    blockLocalEnd: end,
  });
}

function walk(
  node: PreviewNode,
  callback: (node: PreviewNode) => void,
) {
  callback(node);
  node.children?.forEach((child) => walk(child, callback));
}

function isSafeUrl(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value, "https://invalid.local").protocol);
  } catch {
    return false;
  }
}

function uniqueErrors(errors: ImportPreviewValidationError[]) {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.code}:${error.annotationId ?? ""}:${error.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
