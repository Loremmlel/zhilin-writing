import {
  type AnnotationIdFactories,
  buildWordThreads,
  parseWordComments,
  resolveAnnotationThreads,
} from "./annotations.ts";
import { loadDocxLookups } from "./lookups.ts";
import { renderCanonicalImportMarkdown } from "./markdown.ts";
import { openDocxPackage } from "./package.ts";
import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { DocxImportError, type ImportAsset, type ImportWarning, type ParsedDocx } from "./types.ts";
import { walkMainDocument, type WalkedAssetReference } from "./walker.ts";
import { parseOrderedXml } from "./xml.ts";

export type DocxParsePhase = "opening" | "lookups" | "document" | "comments" | "rendering";
export type DocxParseProgress = (phase: DocxParsePhase) => void;
export type DocxParseOptions = AnnotationIdFactories;

export async function parseDocx(
  file: File,
  onProgress?: DocxParseProgress,
  options: DocxParseOptions = {},
): Promise<ParsedDocx> {
  onProgress?.("opening");
  const pkg = await openDocxPackage(file);
  try {
    onProgress?.("lookups");
    const lookups = await loadDocxLookups(pkg);
    onProgress?.("document");
    const document = parseOrderedXml(
      await pkg.readText("word/document.xml"),
      "word/document.xml",
    );
    const footnotes = pkg.has("word/footnotes.xml")
      ? parseOrderedXml(await pkg.readText("word/footnotes.xml"), "word/footnotes.xml")
      : undefined;
    const endnotes = pkg.has("word/endnotes.xml")
      ? parseOrderedXml(await pkg.readText("word/endnotes.xml"), "word/endnotes.xml")
      : undefined;
    const noteParts = { footnotes, endnotes };
    const initialWalked = walkMainDocument(document, lookups, noteParts);
    const materialized = await materializeAssets(pkg, initialWalked.assetReferences);
    const acceptedAssetIds = new Set(materialized.assets.map((asset) => asset.id));
    const walked = materialized.assets.length === initialWalked.assetReferences.length
      ? initialWalked
      : walkMainDocument(document, lookups, noteParts, { acceptedAssetIds });
    const blocks = walked.blocks.filter((block) => block.type !== "image" || acceptedAssetIds.has(block.assetId));
    onProgress?.("comments");
    const comments = pkg.has("word/comments.xml")
      ? parseOrderedXml(await pkg.readText("word/comments.xml"), "word/comments.xml")
      : [];
    const commentsExtended = pkg.has("word/commentsExtended.xml")
      ? parseOrderedXml(
        await pkg.readText("word/commentsExtended.xml"),
        "word/commentsExtended.xml",
      )
      : undefined;
    const resolved = resolveAnnotationThreads(
      walked,
      buildWordThreads(parseWordComments(comments, commentsExtended)),
      options,
    );
    onProgress?.("rendering");
    const canonicalMarkdown = renderCanonicalImportMarkdown(blocks, materialized.assets, resolved.accepted);
    const firstHeading = blocks.find((block) => block.type === "heading");
    const suggestedTitle = firstHeading && "segments" in firstHeading
      ? firstHeading.segments.map((segment) => segment.text).join("").trim()
      : file.name.replace(/\.docx$/i, "");
    return {
      version: 1,
      source: { filename: file.name },
      suggestedTitle,
      blocks,
      assets: materialized.assets,
      threads: resolved.accepted,
      skippedThreads: resolved.skipped,
      warnings: mergeWarnings(walked.warnings, materialized.warnings, resolved.warnings),
      canonicalMarkdown,
    };
  } finally {
    await pkg.close();
  }
}

async function materializeAssets(
  pkg: Awaited<ReturnType<typeof openDocxPackage>>,
  references: WalkedAssetReference[],
): Promise<{ assets: ImportAsset[]; warnings: ImportWarning[] }> {
  const assets: ImportAsset[] = [];
  const bytesByPackagePath = new Map<string, Uint8Array>();
  let unsupported = 0;
  for (const reference of references) {
    const entry = pkg.entries.find((candidate) => candidate.path === reference.packagePath);
    if (!entry) {
      unsupported += 1;
      continue;
    }
    if (entry.uncompressedSize > DOCX_IMPORT_LIMITS.imageBytes) {
      throw new DocxImportError(
        "IMAGE_SIZE_LIMIT",
        `DOCX image exceeds the ${DOCX_IMPORT_LIMITS.imageBytes}-byte limit`,
        { path: reference.packagePath, size: entry.uncompressedSize },
      );
    }
    let bytes = bytesByPackagePath.get(reference.packagePath);
    if (!bytes) {
      bytes = await pkg.readBytes(reference.packagePath);
      if (bytes.byteLength > DOCX_IMPORT_LIMITS.imageBytes) {
        throw new DocxImportError(
          "IMAGE_SIZE_LIMIT",
          `DOCX image exceeds the ${DOCX_IMPORT_LIMITS.imageBytes}-byte limit`,
          { path: reference.packagePath, size: bytes.byteLength },
        );
      }
      bytesByPackagePath.set(reference.packagePath, bytes);
    }
    if (!hasImageSignature(bytes, reference.mimeType)) {
      unsupported += 1;
      continue;
    }
    assets.push({
      id: reference.id,
      filename: reference.filename,
      mimeType: reference.mimeType,
      bytes,
      alt: reference.alt,
      sourceRelationshipId: reference.sourceRelationshipId,
      floating: reference.floating,
    });
  }
  return {
    assets,
    warnings: unsupported > 0
      ? [{ code: "IMAGE_FORMAT_UNSUPPORTED", severity: "warning", count: unsupported }]
      : [],
  };
}

function hasImageSignature(bytes: Uint8Array, mimeType: ImportAsset["mimeType"]): boolean {
  if (mimeType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/gif") {
    return new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a"
      || new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a";
  }
  return bytes.byteLength >= 12
    && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
}

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return bytes.byteLength >= expected.length
    && expected.every((value, index) => bytes[index] === value);
}

function mergeWarnings(...groups: ImportWarning[][]): ImportWarning[] {
  const merged: ImportWarning[] = [];
  for (const warning of groups.flat()) {
    if (warning.sourceRef) {
      merged.push(warning);
      continue;
    }
    const existing = merged.find((candidate) => candidate.code === warning.code && !candidate.sourceRef);
    if (existing) existing.count = (existing.count ?? 1) + (warning.count ?? 1);
    else merged.push({ ...warning });
  }
  return merged;
}
