import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import {
  DocxImportError,
  type ImportAsset,
  type ImportBlock,
  type ImportedThread,
  type InlineSegment,
  type ListBlock,
} from "./types.ts";

const encoder = new TextEncoder();

export function renderCanonicalImportMarkdown(
  blocks: ImportBlock[],
  assets: ImportAsset[],
  threads: ImportedThread[],
): string {
  void assets;
  void threads;
  const rendered: Array<{ type: ImportBlock["type"]; value: string }> = [];
  for (const block of blocks) {
    const value = renderBlock(block);
    if (value || block.type === "paragraph") rendered.push({ type: block.type, value });
  }

  let markdown = "";
  for (const [index, current] of rendered.entries()) {
    if (index > 0) {
      markdown += "\n\n";
    }
    markdown += current.value;
  }
  markdown = markdown
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();

  const byteLength = encoder.encode(markdown).byteLength;
  if (byteLength > DOCX_IMPORT_LIMITS.markdownUtf8Bytes) {
    throw new DocxImportError(
      "MARKDOWN_SIZE_LIMIT",
      `Imported Markdown exceeds the ${DOCX_IMPORT_LIMITS.markdownUtf8Bytes}-byte limit`,
      { byteLength },
    );
  }
  return markdown;
}

function renderBlock(block: ImportBlock): string {
  if (block.type === "paragraph") return renderInline(block.segments);
  if (block.type === "heading") return `${"#".repeat(block.level)} ${renderInline(block.segments)}`;
  if (block.type === "quote") {
    return renderInline(block.segments).split("\n").map((line) => `> ${line}`).join("\n");
  }
  if (block.type === "list") return renderList(block);
  if (block.type === "table") return "";
  if (block.type === "image") return "";
  if (block.type === "notesAppendix") return "";
  return "";
}

function renderList(block: ListBlock): string {
  const prefix = `${"  ".repeat(block.depth)}${block.ordered ? "1." : "-"} `;
  return block.items.map((item) => {
    const own = `${prefix}${renderInline(item.segments)}`;
    const children = item.children.map(renderList).filter(Boolean);
    return children.length ? `${own}\n${children.join("\n")}` : own;
  }).join("\n");
}

function renderInline(segments: InlineSegment[]): string {
  return segments.map((segment) => {
    let value = segment.marks.includes("code")
      ? renderCode(segment.text)
      : escapeMarkdown(segment.text);
    if (segment.marks.includes("strike")) value = `~~${value}~~`;
    if (segment.marks.includes("em")) value = `*${value}*`;
    if (segment.marks.includes("strong")) value = `**${value}**`;
    if (segment.link) value = `[${value}](${escapeLinkDestination(segment.link)})`;
    return value;
  }).join("");
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]~#>+\-.!|])/g, "\\$1");
}

function renderCode(value: string): string {
  const longestRun = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  const needsPadding = value.startsWith("`") || value.endsWith("`") || value.startsWith(" ") || value.endsWith(" ");
  return `${delimiter}${needsPadding ? " " : ""}${value}${needsPadding ? " " : ""}${delimiter}`;
}

function escapeLinkDestination(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/ /g, "%20");
}
