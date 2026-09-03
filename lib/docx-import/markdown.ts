import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import {
  DocxImportError,
  type ImportAsset,
  type ImportBlock,
  type ImportedThread,
  type InlineSegment,
  type ListBlock,
} from "./types.ts";
import { importedThreadSlices } from "./thread-range.ts";

const encoder = new TextEncoder();

export function renderCanonicalImportMarkdown(
  blocks: ImportBlock[],
  assets: ImportAsset[],
  threads: ImportedThread[],
): string {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const threadsByBlock = new Map<
    string,
    Array<Pick<ImportedThread, "annotationId"> & { blockLocalStart: number; blockLocalEnd: number }>
  >();
  for (const thread of threads) {
    for (const slice of importedThreadSlices(blocks, thread) ?? []) {
      const blockThreads = threadsByBlock.get(slice.blockId) ?? [];
      blockThreads.push({
        annotationId: thread.annotationId,
        blockLocalStart: slice.from,
        blockLocalEnd: slice.to,
      });
      threadsByBlock.set(slice.blockId, blockThreads);
    }
  }
  const rendered: Array<{ type: ImportBlock["type"]; value: string }> = [];
  for (const block of blocks) {
    const value = renderBlock(block, threadsByBlock, assetIds);
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

function renderBlock(
  block: ImportBlock,
  threadsByBlock: Map<
    string,
    Array<Pick<ImportedThread, "annotationId"> & { blockLocalStart: number; blockLocalEnd: number }>
  >,
  assetIds: ReadonlySet<string>,
): string {
  if (block.type === "paragraph") return renderInline(block.segments, threadsByBlock.get(block.id));
  if (block.type === "heading") {
    return `${"#".repeat(block.level)} ${renderInline(block.segments, threadsByBlock.get(block.id))}`;
  }
  if (block.type === "quote") {
    return renderInline(block.segments, threadsByBlock.get(block.id))
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (block.type === "list") return renderList(block, threadsByBlock);
  if (block.type === "table") {
    const row = (cells: typeof block.header.cells) =>
      `| ${cells.map((cell) => renderTableCell(cell.segments)).join(" | ")} |`;
    const separator = `| ${block.header.cells.map(() => "---").join(" | ")} |`;
    return [row(block.header.cells), separator, ...block.rows.map((item) => row(item.cells))].join(
      "\n",
    );
  }
  if (block.type === "image") {
    return assetIds.has(block.assetId)
      ? `![${escapeMarkdownLiteral(block.alt)}](docx-asset:${block.assetId})`
      : "";
  }
  if (block.type === "notesAppendix") {
    return `---\n\n${block.title}\n\n${block.notes
      .map((note) => `[${note.number}] ${renderInline(note.segments)}`)
      .join("\n\n")}`;
  }
  return "";
}

function renderTableCell(segments: InlineSegment[]): string {
  return renderInline(segments)
    .replace(/(?<!\\)\|/g, "\\|")
    .replace(/\r?\n/g, "\\n");
}

function renderList(
  block: ListBlock,
  threadsByBlock: Map<
    string,
    Array<Pick<ImportedThread, "annotationId"> & { blockLocalStart: number; blockLocalEnd: number }>
  >,
): string {
  const prefix = `${"  ".repeat(block.depth)}${block.ordered ? "1." : "-"} `;
  return block.items
    .map((item) => {
      const own = `${prefix}${renderInline(item.segments, threadsByBlock.get(item.id))}`;
      const children = item.children
        .map((child) => renderList(child, threadsByBlock))
        .filter(Boolean);
      return children.length ? `${own}\n${children.join("\n")}` : own;
    })
    .join("\n");
}

function renderInline(
  segments: InlineSegment[],
  threads: Array<
    Pick<ImportedThread, "annotationId"> & { blockLocalStart: number; blockLocalEnd: number }
  > = [],
): string {
  if (threads.length === 0) return renderSegmentSlice(segments, 0, Number.POSITIVE_INFINITY);
  const ranges = [...threads].sort((left, right) => left.blockLocalStart - right.blockLocalStart);
  let cursor = 0;
  let rendered = "";
  for (const thread of ranges) {
    rendered += renderSegmentSlice(segments, cursor, thread.blockLocalStart);
    rendered += `:annotation[${renderSegmentSlice(
      segments,
      thread.blockLocalStart,
      thread.blockLocalEnd,
    )}]{#${thread.annotationId}}`;
    cursor = thread.blockLocalEnd;
  }
  return rendered + renderSegmentSlice(segments, cursor, Number.POSITIVE_INFINITY);
}

function renderSegmentSlice(segments: InlineSegment[], start: number, end: number): string {
  let cursor = 0;
  const selected: InlineSegment[] = [];
  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.text.length;
    cursor = segmentEnd;
    if (segmentEnd <= start || segmentStart >= end) continue;
    const text = segment.text.slice(
      Math.max(0, start - segmentStart),
      Math.min(segment.text.length, end - segmentStart),
    );
    const previous = selected.at(-1);
    if (
      previous &&
      previous.synthetic === segment.synthetic &&
      previous.link === segment.link &&
      previous.marks.length === segment.marks.length &&
      previous.marks.every((mark, index) => mark === segment.marks[index])
    ) {
      previous.text += text;
    } else {
      selected.push({ ...segment, text });
    }
  }

  return selected
    .map((segment) => {
      const text = segment.text;
      let value = segment.synthetic
        ? text
        : segment.marks.includes("code")
          ? renderCode(text)
          : escapeMarkdownLiteral(text);
      if (segment.synthetic) return value;
      if (segment.marks.includes("strike")) value = `~~${value}~~`;
      if (segment.marks.includes("em")) value = `*${value}*`;
      if (segment.marks.includes("strong")) value = `**${value}**`;
      if (segment.link) value = `[${value}](${escapeLinkDestination(segment.link)})`;
      return value;
    })
    .join("");
}

export function escapeMarkdownLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_[\]~#>+\-.!|:&])/g, "\\$1");
}

function renderCode(value: string): string {
  const longestRun = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  const needsPadding =
    value.startsWith("`") || value.endsWith("`") || value.startsWith(" ") || value.endsWith(" ");
  return `${delimiter}${needsPadding ? " " : ""}${value}${needsPadding ? " " : ""}${delimiter}`;
}

function escapeLinkDestination(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/ /g, "%20");
}
