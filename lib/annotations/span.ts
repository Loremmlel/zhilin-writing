type MarkdownNodeLike = {
  type: string;
  children?: MarkdownNodeLike[];
};

export type AnnotationDocumentBlock<T extends MarkdownNodeLike = MarkdownNodeLike> = {
  node: T;
  documentIndex: number;
  eligibleOrdinal: number | null;
  supported: boolean;
};

const transparentBlockContainers = new Set(["blockquote", "list", "listItem"]);

export function isSupportedAnnotationBlock(node: MarkdownNodeLike, parentType: string): boolean {
  return (node.type === "heading" && parentType === "root")
    || (node.type === "paragraph" && ["root", "listItem", "blockquote"].includes(parentType));
}

export function collectAnnotationDocumentBlocks<T extends MarkdownNodeLike>(root: T): AnnotationDocumentBlock<T>[] {
  const blocks: AnnotationDocumentBlock<T>[] = [];
  let eligibleOrdinal = 0;

  const walk = (container: MarkdownNodeLike) => {
    for (const child of container.children ?? []) {
      if (isSupportedAnnotationBlock(child, container.type)) {
        blocks.push({
          node: child as T,
          documentIndex: blocks.length,
          eligibleOrdinal: eligibleOrdinal++,
          supported: true,
        });
      } else if (transparentBlockContainers.has(child.type)) {
        walk(child);
      } else if (child.type !== "definition") {
        blocks.push({ node: child as T, documentIndex: blocks.length, eligibleOrdinal: null, supported: false });
      }
    }
  };

  walk(root);
  return blocks;
}

export type AnnotationSpanSegment = {
  blockIndex: number;
  from: number;
  to: number;
  firstVisibleFrom: number;
  lastVisibleTo: number;
};

export function isCanonicalMultiBlockAnnotationSpan(segments: readonly AnnotationSpanSegment[]): boolean {
  if (segments.length <= 1) return true;
  const ordered = [...segments].sort((left, right) => left.blockIndex - right.blockIndex || left.from - right.from);
  if (ordered.some((segment, index) => index > 0 && segment.blockIndex !== ordered[index - 1]!.blockIndex + 1)) return false;
  return ordered.every((segment, index) => {
    if (index === 0) return segment.to >= segment.lastVisibleTo;
    if (index === ordered.length - 1) return segment.from <= segment.firstVisibleFrom;
    return segment.from <= segment.firstVisibleFrom && segment.to >= segment.lastVisibleTo;
  });
}
