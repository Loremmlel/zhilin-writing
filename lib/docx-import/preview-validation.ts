import { parseAnnotationMarkdown } from "../annotations/markdown.ts";
import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import type {
  DocxImportIR,
  DocxPreviewRecord,
  ImportBlock,
  InlineSegment,
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
  const counts = new Map<string, number>();
  const referencedAssets = new Set<string>();
  walk(tree, [], (node, ancestors) => {
    if ((node.type === "link" || node.type === "image") && node.url && !isSafeUrl(node.url)) {
      errors.push({ code: "UNSAFE_EXTERNAL_URL", url: node.url });
    }
    if ((node.type === "link" || node.type === "image") && node.url?.startsWith("/api/assets/")) {
      referencedAssets.add(node.url);
    }
    if (node.type !== "textDirective" || node.name !== "annotation") return;
    const id = node.attributes?.id;
    if (!id) {
      errors.push({ code: "ANNOTATION_ANCHOR_UNKNOWN" });
      return;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const thread = expected.get(id);
    if (!thread) errors.push({ code: "ANNOTATION_ANCHOR_UNKNOWN", annotationId: id });
    if (ancestors.some((ancestor) => ancestor.type === "textDirective" && ancestor.name === "annotation")) {
      errors.push({ code: "ANNOTATION_NESTED", annotationId: id });
    }
    if (thread) {
      const expectedText = getImportedThreadSelectedText(ir.blocks, thread.blockId, thread.blockLocalStart, thread.blockLocalEnd);
      if (visibleNodeText(node) !== expectedText) {
        errors.push({ code: "ANNOTATION_TEXT_CHANGED", annotationId: id });
      }
    }
  });
  for (const id of expected.keys()) {
    const count = counts.get(id) ?? 0;
    if (count === 0) errors.push({ code: "ANNOTATION_ANCHOR_MISSING", annotationId: id });
    else if (count > 1) errors.push({ code: "ANNOTATION_ANCHOR_DUPLICATE", annotationId: id });
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
  const byBlock = new Map<string, typeof ir.threads>();
  for (const thread of ir.threads) {
    const threads = byBlock.get(thread.blockId) ?? [];
    threads.push(thread);
    byBlock.set(thread.blockId, threads);
  }
  for (const threads of byBlock.values()) {
    const ordered = [...threads].sort((left, right) => left.blockLocalStart - right.blockLocalStart || left.blockLocalEnd - right.blockLocalEnd);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.blockLocalStart < ordered[index - 1]!.blockLocalEnd) {
        errors.push({ code: "ANNOTATION_OVERLAP", annotationId: ordered[index]!.annotationId });
      }
    }
  }
}

export function getImportedThreadSelectedText(blocks: ImportBlock[], blockId: string, start: number, end: number): string {
  const segments = findSegments(blocks, blockId);
  if (!segments) return "";
  const value = segments.map((segment) => segment.text).join("");
  return value.slice(start, end);
}

function findSegments(blocks: ImportBlock[], blockId: string): InlineSegment[] | null {
  for (const block of blocks) {
    if (block.id === blockId && "segments" in block) return block.segments;
    if (block.type !== "list") continue;
    for (const item of block.items) {
      if (item.id === blockId) return item.segments;
      const nested = findSegments(item.children, blockId);
      if (nested) return nested;
    }
  }
  return null;
}

function visibleNodeText(node: PreviewNode): string {
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value ?? "";
  if (node.type === "image") return node.alt ?? "";
  return node.children?.map(visibleNodeText).join("") ?? "";
}

function walk(
  node: PreviewNode,
  ancestors: PreviewNode[],
  callback: (node: PreviewNode, ancestors: PreviewNode[]) => void,
) {
  callback(node, ancestors);
  node.children?.forEach((child) => walk(child, [...ancestors, node], callback));
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
