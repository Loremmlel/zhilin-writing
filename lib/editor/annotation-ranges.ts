import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";

export type EditorAnnotationEndpoint = {
  from: number;
  to: number;
  text: string;
};

export type EditorAnnotationRange = {
  annotationId: string;
  from: number;
  to: number;
  blockFrom: number;
  blockTo: number;
  blockType: string;
  text: string;
  firstEndpoint: EditorAnnotationEndpoint;
  lastEndpoint: EditorAnnotationEndpoint;
};

export type AnnotationRangeIssueCode =
  | "EMPTY"
  | "MULTI_BLOCK"
  | "DUPLICATE"
  | "OVERLAP"
  | "NESTED"
  | "INVALID_BLOCK";

export type AnnotationRangeIssue = {
  annotationId: string;
  code: AnnotationRangeIssueCode;
};

type TextPiece = {
  from: number;
  to: number;
  text: string;
};

type RangeBuilder = EditorAnnotationRange & {
  pieces: TextPiece[];
  validBlock: boolean;
  validInline: boolean;
};

type Fragment = {
  annotationId: string;
  from: number;
  to: number;
  blockFrom: number;
  blockTo: number;
  blockType: string;
  text: string;
  validBlock: boolean;
  validInline: boolean;
};

const allowedFormattingMarks = new Set(["annotation", "strong", "emphasis", "strike_through", "link"]);
const graphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" })
  : null;

function visibleGraphemes(text: string): Array<{ index: number; text: string }> {
  if (graphemeSegmenter) {
    return [...graphemeSegmenter.segment(text)]
      .map((part) => ({ index: part.index, text: part.segment }))
      .filter((part) => part.text.trim().length > 0);
  }
  const result: Array<{ index: number; text: string }> = [];
  let index = 0;
  for (const textPart of text) {
    if (textPart.trim().length > 0) result.push({ index, text: textPart });
    index += textPart.length;
  }
  return result;
}

function positionAtOffset(pieces: TextPiece[], offset: number): number {
  let consumed = 0;
  for (const piece of pieces) {
    const next = consumed + piece.text.length;
    if (offset <= next) return piece.from + Math.min(offset - consumed, piece.to - piece.from);
    consumed = next;
  }
  return pieces.at(-1)?.to ?? 0;
}

function endpointFor(pieces: TextPiece[], segment: { index: number; text: string } | undefined): EditorAnnotationEndpoint {
  if (!segment) {
    const position = pieces[0]?.from ?? 0;
    return { from: position, to: position, text: "" };
  }
  return {
    from: positionAtOffset(pieces, segment.index),
    to: positionAtOffset(pieces, segment.index + segment.text.length),
    text: segment.text,
  };
}

function blockAt(doc: ProseMirrorNode, pos: number) {
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (!node.isTextblock) continue;
    const parentType = resolved.node(depth - 1).type.name;
    const blockType = node.type.name;
    const validBlock = (blockType === "heading" && parentType === "doc")
      || (blockType === "paragraph" && ["doc", "list_item", "blockquote"].includes(parentType));
    return {
      blockFrom: resolved.before(depth),
      blockTo: resolved.after(depth),
      blockType,
      validBlock,
    };
  }
  return { blockFrom: pos, blockTo: pos, blockType: "unknown", validBlock: false };
}

function addIssue(issues: AnnotationRangeIssue[], annotationId: string, code: AnnotationRangeIssueCode) {
  if (!issues.some((issue) => issue.annotationId === annotationId && issue.code === code)) {
    issues.push({ annotationId, code });
  }
}

export function analyzeAnnotationRanges(doc: ProseMirrorNode): {
  ranges: EditorAnnotationRange[];
  issues: AnnotationRangeIssue[];
} {
  const fragments: Fragment[] = [];
  doc.descendants((node, pos) => {
    const annotationIds = [...new Set(node.marks
      .filter((mark) => mark.type.name === "annotation")
      .map((mark) => mark.attrs.annotationId)
      .filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (annotationIds.length === 0) return;
    const block = blockAt(doc, pos);
    const validInline = node.isText && node.marks.every((mark) => allowedFormattingMarks.has(mark.type.name));
    for (const annotationId of annotationIds) {
      fragments.push({
        annotationId,
        from: pos,
        to: pos + node.nodeSize,
        ...block,
        text: node.isText ? node.text ?? "" : "",
        validInline,
      });
    }
  });

  fragments.sort((left, right) => left.from - right.from || left.to - right.to || left.annotationId.localeCompare(right.annotationId));
  const buildersById = new Map<string, RangeBuilder[]>();
  for (const fragment of fragments) {
    const builders = buildersById.get(fragment.annotationId) ?? [];
    const previous = builders.at(-1);
    if (previous && previous.to === fragment.from && previous.blockFrom === fragment.blockFrom) {
      previous.to = fragment.to;
      previous.text += fragment.text;
      previous.pieces.push({ from: fragment.from, to: fragment.to, text: fragment.text });
      previous.validBlock &&= fragment.validBlock;
      previous.validInline &&= fragment.validInline;
    } else {
      builders.push({
        annotationId: fragment.annotationId,
        from: fragment.from,
        to: fragment.to,
        blockFrom: fragment.blockFrom,
        blockTo: fragment.blockTo,
        blockType: fragment.blockType,
        text: fragment.text,
        firstEndpoint: { from: fragment.from, to: fragment.from, text: "" },
        lastEndpoint: { from: fragment.from, to: fragment.from, text: "" },
        pieces: [{ from: fragment.from, to: fragment.to, text: fragment.text }],
        validBlock: fragment.validBlock,
        validInline: fragment.validInline,
      });
    }
    buildersById.set(fragment.annotationId, builders);
  }

  const builders = [...buildersById.values()].flat();
  for (const builder of builders) {
    const segments = visibleGraphemes(builder.text);
    builder.firstEndpoint = endpointFor(builder.pieces, segments[0]);
    builder.lastEndpoint = endpointFor(builder.pieces, segments.at(-1));
  }
  builders.sort((left, right) => left.from - right.from || right.to - left.to || left.annotationId.localeCompare(right.annotationId));

  const issues: AnnotationRangeIssue[] = [];
  for (const builder of builders) {
    if (!builder.validBlock || !builder.validInline) addIssue(issues, builder.annotationId, "INVALID_BLOCK");
    if (builder.firstEndpoint.text.length === 0) addIssue(issues, builder.annotationId, "EMPTY");
  }
  for (const [annotationId, ranges] of buildersById) {
    const byBlock = new Map<number, number>();
    for (const range of ranges) byBlock.set(range.blockFrom, (byBlock.get(range.blockFrom) ?? 0) + 1);
    if (byBlock.size > 1) addIssue(issues, annotationId, "MULTI_BLOCK");
    if ([...byBlock.values()].some((count) => count > 1)) addIssue(issues, annotationId, "DUPLICATE");
  }

  const activeByBlock = new Map<number, RangeBuilder[]>();
  for (const current of builders) {
    const active = (activeByBlock.get(current.blockFrom) ?? []).filter((range) => range.to > current.from);
    for (const other of active) {
      if (other.annotationId === current.annotationId || other.to <= current.from) continue;
      const nested = (other.from <= current.from && other.to >= current.to)
        || (current.from <= other.from && current.to >= other.to);
      const exact = other.from === current.from && other.to === current.to;
      const code: AnnotationRangeIssueCode = nested && !exact ? "NESTED" : "OVERLAP";
      addIssue(issues, other.annotationId, code);
      addIssue(issues, current.annotationId, code);
    }
    active.push(current);
    activeByBlock.set(current.blockFrom, active);
  }

  const issuePriority: Record<AnnotationRangeIssueCode, number> = {
    EMPTY: 0,
    MULTI_BLOCK: 1,
    DUPLICATE: 2,
    OVERLAP: 3,
    NESTED: 4,
    INVALID_BLOCK: 5,
  };
  const positionById = new Map<string, number>();
  for (const range of builders) {
    if (!positionById.has(range.annotationId)) positionById.set(range.annotationId, range.from);
  }
  issues.sort((left, right) => (positionById.get(left.annotationId) ?? Number.MAX_SAFE_INTEGER)
    - (positionById.get(right.annotationId) ?? Number.MAX_SAFE_INTEGER)
    || issuePriority[left.code] - issuePriority[right.code]
    || left.annotationId.localeCompare(right.annotationId));

  return {
    ranges: builders.map((range) => ({
      annotationId: range.annotationId,
      from: range.from,
      to: range.to,
      blockFrom: range.blockFrom,
      blockTo: range.blockTo,
      blockType: range.blockType,
      text: range.text,
      firstEndpoint: range.firstEndpoint,
      lastEndpoint: range.lastEndpoint,
    })),
    issues,
  };
}

export function scanAnnotationRanges(doc: ProseMirrorNode): EditorAnnotationRange[] {
  return analyzeAnnotationRanges(doc).ranges;
}
