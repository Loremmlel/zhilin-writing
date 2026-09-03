import type { ImportBlock, InlineSegment } from "./types.ts";

export type ImportedThreadRange = {
  blockId: string;
  endBlockId?: string;
  blockLocalStart: number;
  blockLocalEnd: number;
};

export type ImportedThreadSlice = {
  blockId: string;
  segments: InlineSegment[];
  from: number;
  to: number;
};

type ImportDocumentBlock = {
  blockId: string;
  segments: InlineSegment[];
  supported: boolean;
};

function importDocumentBlocks(blocks: ImportBlock[]): ImportDocumentBlock[] {
  const result: ImportDocumentBlock[] = [];
  const visit = (items: ImportBlock[]) => {
    for (const block of items) {
      if ("segments" in block) {
        result.push({ blockId: block.id, segments: block.segments, supported: true });
      } else if (block.type === "list") {
        for (const item of block.items) {
          result.push({ blockId: item.id, segments: item.segments, supported: true });
          visit(item.children);
        }
      } else {
        result.push({ blockId: block.id, segments: [], supported: false });
      }
    }
  };
  visit(blocks);
  return result;
}

export function importTextBlocks(
  blocks: ImportBlock[],
): Array<{ blockId: string; segments: InlineSegment[] }> {
  return importDocumentBlocks(blocks)
    .filter((block) => block.supported)
    .map(({ blockId, segments }) => ({ blockId, segments }));
}

export function importedThreadSlices(
  blocks: ImportBlock[],
  thread: ImportedThreadRange,
): ImportedThreadSlice[] | null {
  const documentBlocks = importDocumentBlocks(blocks);
  const startIndex = documentBlocks.findIndex(
    (block) => block.blockId === thread.blockId && block.supported,
  );
  const endBlockId = thread.endBlockId ?? thread.blockId;
  const endIndex = documentBlocks.findIndex(
    (block) => block.blockId === endBlockId && block.supported,
  );
  if (startIndex < 0 || endIndex < startIndex) return null;

  const selectedBlocks = documentBlocks.slice(startIndex, endIndex + 1);
  if (selectedBlocks.some((block) => !block.supported)) return null;
  const selected = selectedBlocks.map((block, index, items) => {
    const length = block.segments.reduce((total, segment) => total + segment.text.length, 0);
    const from = index === 0 ? thread.blockLocalStart : 0;
    const to = index === items.length - 1 ? thread.blockLocalEnd : length;
    return { ...block, from, to, length };
  });
  if (
    selected.some(
      (slice) =>
        !Number.isInteger(slice.from) ||
        !Number.isInteger(slice.to) ||
        slice.from < 0 ||
        slice.to <= slice.from ||
        slice.to > slice.length,
    )
  )
    return null;
  return selected.map((slice) => ({
    blockId: slice.blockId,
    segments: slice.segments,
    from: slice.from,
    to: slice.to,
  }));
}

export function importedThreadSelectedText(
  blocks: ImportBlock[],
  thread: ImportedThreadRange,
): string {
  return (
    importedThreadSlices(blocks, thread)
      ?.map((slice) => {
        const text = slice.segments.map((segment) => segment.text).join("");
        return text.slice(slice.from, slice.to);
      })
      .join("\n\n") ?? ""
  );
}
