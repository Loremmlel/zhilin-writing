import {
  type AnnotationIdFactories,
  buildWordThreads,
  parseWordComments,
  resolveAnnotationThreads,
} from "./annotations.ts";
import { loadDocxLookups } from "./lookups.ts";
import { renderCanonicalImportMarkdown } from "./markdown.ts";
import { openDocxPackage } from "./package.ts";
import type { ParsedDocx } from "./types.ts";
import { walkMainDocument } from "./walker.ts";
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
    const walked = walkMainDocument(document, lookups);
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
    const canonicalMarkdown = renderCanonicalImportMarkdown(walked.blocks, [], resolved.accepted);
    const firstHeading = walked.blocks.find((block) => block.type === "heading");
    const suggestedTitle = firstHeading && "segments" in firstHeading
      ? firstHeading.segments.map((segment) => segment.text).join("").trim()
      : file.name.replace(/\.docx$/i, "");
    return {
      version: 1,
      source: { filename: file.name },
      suggestedTitle,
      blocks: walked.blocks,
      assets: [],
      threads: resolved.accepted,
      skippedThreads: resolved.skipped,
      warnings: [...walked.warnings, ...resolved.warnings],
      canonicalMarkdown,
    };
  } finally {
    await pkg.close();
  }
}
