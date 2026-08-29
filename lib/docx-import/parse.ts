import { loadDocxLookups } from "./lookups.ts";
import { renderCanonicalImportMarkdown } from "./markdown.ts";
import { openDocxPackage } from "./package.ts";
import type { ParsedDocx } from "./types.ts";
import { walkMainDocument } from "./walker.ts";
import { parseOrderedXml } from "./xml.ts";

export type DocxParsePhase = "opening" | "lookups" | "document" | "rendering";
export type DocxParseProgress = (phase: DocxParsePhase) => void;

export async function parseDocx(file: File, onProgress?: DocxParseProgress): Promise<ParsedDocx> {
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
    onProgress?.("rendering");
    const canonicalMarkdown = renderCanonicalImportMarkdown(walked.blocks, [], []);
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
      threads: [],
      skippedThreads: [],
      warnings: walked.warnings,
      canonicalMarkdown,
    };
  } finally {
    await pkg.close();
  }
}
