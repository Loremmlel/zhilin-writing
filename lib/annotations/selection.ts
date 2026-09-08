import { isTextStyleDirective } from "../markdown/formatting.ts";
import type {
  AnnotationId,
  AnnotationMarkdownRoot,
  AnnotationSelectionDescriptor,
} from "./types.ts";
import { isAttachmentAssetHref } from "./inline-policy.ts";
import { collectAnnotationDocumentBlocks } from "./span.ts";

type InlineNode = {
  type: string;
  value?: string;
  url?: string;
  children?: InlineNode[];
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  position?: unknown;
  [key: string]: unknown;
};

type AnnotationBlock = InlineNode & { children: InlineNode[] };

export type AnnotationSelectionErrorCode =
  | "BLANK_SELECTION"
  | "CROSS_BLOCK"
  | "INVALID_BLOCK"
  | "INVALID_RANGE"
  | "NESTED_ANNOTATION"
  | "REVISION_MISMATCH"
  | "TEXT_MISMATCH"
  | "UNSUPPORTED_DIRECTIVE"
  | "UNSUPPORTED_INLINE"
  | "OVERLAP";

export class AnnotationSelectionError extends Error {
  readonly code: AnnotationSelectionErrorCode;

  constructor(code: AnnotationSelectionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AnnotationSelectionError";
  }
}

const supportedContainers = new Set(["strong", "emphasis", "delete", "link", "textDirective"]);

function cloneWithoutPosition<T extends InlineNode>(node: T): T {
  const rest = { ...node };
  delete rest.position;
  return structuredClone(rest) as T;
}

function inlineText(node: InlineNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return node.children?.map(inlineText).join("") ?? "";
}

function nodeTextLength(node: InlineNode): number {
  return inlineText(node).length;
}
function isAttachmentLink(node: InlineNode): boolean {
  return node.type === "link" && isAttachmentAssetHref(node.url);
}

function assertSupportedBlock(block: AnnotationBlock) {
  const visit = (node: InlineNode, annotationDepth: number) => {
    if (
      ["inlineCode", "image", "imageReference", "break", "footnoteReference", "html"].includes(
        node.type,
      ) ||
      isAttachmentLink(node)
    ) {
      throw new AnnotationSelectionError(
        "UNSUPPORTED_INLINE",
        "所选文本所在段落包含暂不支持的内联内容",
      );
    }
    if (node.type === "textDirective" && !isTextStyleDirective(node)) {
      if (node.name !== "annotation") return;
      if (annotationDepth > 0)
        throw new AnnotationSelectionError(
          "NESTED_ANNOTATION",
          "正文中的批注结构异常，暂时无法在此处添加批注",
        );
      annotationDepth += 1;
    } else if (node.type !== "text" && node.children && !supportedContainers.has(node.type)) {
      throw new AnnotationSelectionError("UNSUPPORTED_INLINE", "所选文本包含暂不支持的内联格式");
    }
    node.children?.forEach((child) => visit(child, annotationDepth));
  };
  block.children.forEach((node) => visit(node, 0));
}

function unsupportedDirectiveRanges(nodes: InlineNode[]) {
  const ranges: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  const scan = (node: InlineNode) => {
    const start = cursor;
    if (node.type === "text" || node.type === "inlineCode") cursor += (node.value ?? "").length;
    else node.children?.forEach(scan);
    if (node.type === "textDirective" && node.name !== "annotation" && !isTextStyleDirective(node))
      ranges.push({ from: start, to: cursor });
  };
  nodes.forEach(scan);
  return ranges;
}

function annotationRanges(nodes: InlineNode[]) {
  const ranges: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  const scan = (node: InlineNode, annotationDepth: number) => {
    const start = cursor;
    if (node.type === "text" || node.type === "inlineCode") {
      cursor += (node.value ?? "").length;
      return;
    }
    if (node.type === "textDirective" && node.name === "annotation") {
      if (annotationDepth > 0)
        throw new AnnotationSelectionError(
          "NESTED_ANNOTATION",
          "正文中的批注结构异常，暂时无法在此处添加批注",
        );
      node.children?.forEach((child) => scan(child, annotationDepth + 1));
      ranges.push({ from: start, to: cursor });
      return;
    }
    node.children?.forEach((child) => scan(child, annotationDepth));
  };
  nodes.forEach((node) => scan(node, 0));
  return ranges;
}

export function validateAnnotationSelection(
  tree: AnnotationMarkdownRoot,
  descriptor: AnnotationSelectionDescriptor,
) {
  const entries = collectAnnotationDocumentBlocks(tree as InlineNode);
  const eligible = entries.filter((entry) => entry.supported);
  if (
    !Number.isInteger(descriptor.blockOrdinal) ||
    !Number.isInteger(descriptor.endBlockOrdinal) ||
    descriptor.blockOrdinal < 0 ||
    descriptor.endBlockOrdinal < descriptor.blockOrdinal
  ) {
    throw new AnnotationSelectionError("INVALID_BLOCK", "所选文本不在可批注的正文块中");
  }
  const startEntry = eligible[descriptor.blockOrdinal];
  const endEntry = eligible[descriptor.endBlockOrdinal];
  if (!startEntry || !endEntry)
    throw new AnnotationSelectionError("INVALID_BLOCK", "所选文本不在可批注的正文块中");
  if (
    entries
      .slice(startEntry.documentIndex, endEntry.documentIndex + 1)
      .some((entry) => !entry.supported)
  ) {
    throw new AnnotationSelectionError(
      "CROSS_BLOCK",
      "跨段批注不能穿过代码块、表格或其他不支持的内容",
    );
  }
  const blocks = eligible
    .slice(descriptor.blockOrdinal, descriptor.endBlockOrdinal + 1)
    .map((entry, index, selected) => {
      const block = entry.node as AnnotationBlock;
      const text = block.children.map(inlineText).join("");
      const from = index === 0 ? descriptor.blockTextFrom : 0;
      const to = index === selected.length - 1 ? descriptor.blockTextTo : text.length;
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to <= from ||
        to > text.length
      ) {
        assertSupportedBlock(block);
        throw new AnnotationSelectionError("INVALID_RANGE", "批注选区已经失效");
      }
      const selectedText = text.slice(from, to);
      if (!selectedText.trim())
        throw new AnnotationSelectionError("BLANK_SELECTION", "请选择至少一个非空白字符");
      return { block, blockText: text, from, to, selectedText };
    });
  const block = blocks[0]!.block;
  const blockText = blocks[0]!.blockText;
  const selectedText = blocks.map((item) => item.selectedText).join("\n\n");
  if (selectedText !== descriptor.selectedText)
    throw new AnnotationSelectionError("TEXT_MISMATCH", "正文已经变化，请重新选择文字");
  for (const { block, from, to } of blocks) {
    assertSupportedBlock(block);
    if (
      unsupportedDirectiveRanges(block.children).some((range) => from < range.to && to > range.from)
    ) {
      throw new AnnotationSelectionError("UNSUPPORTED_DIRECTIVE", "所选文字包含暂不支持的格式");
    }
    if (annotationRanges(block.children).some((range) => from < range.to && to > range.from)) {
      throw new AnnotationSelectionError("OVERLAP", "所选内容与已有批注重叠，无法再次添加批注");
    }
  }
  return { block, blockText, blocks };
}

type SplitResult = { before: InlineNode[]; selected: InlineNode[]; after: InlineNode[] };

function cloneWrapper(node: InlineNode, children: InlineNode[]): InlineNode | null {
  if (children.length === 0) return null;
  const clone = cloneWithoutPosition(node);
  clone.children = children;
  return clone;
}

function splitNode(node: InlineNode, from: number, to: number): SplitResult {
  const length = nodeTextLength(node);
  if (from === 0 && to === length)
    return { before: [], selected: [cloneWithoutPosition(node)], after: [] };
  if (node.type === "text") {
    const value = node.value ?? "";
    const make = (part: string) => (part ? [{ ...cloneWithoutPosition(node), value: part }] : []);
    return {
      before: make(value.slice(0, from)),
      selected: make(value.slice(from, to)),
      after: make(value.slice(to)),
    };
  }
  if (!node.children)
    throw new AnnotationSelectionError("UNSUPPORTED_INLINE", "无法安全拆分所选内容");
  const split = splitNodes(node.children, from, to);
  const before = cloneWrapper(node, split.before);
  const selected = cloneWrapper(node, split.selected);
  const after = cloneWrapper(node, split.after);
  return {
    before: before ? [before] : [],
    selected: selected ? [selected] : [],
    after: after ? [after] : [],
  };
}

function splitNodes(nodes: InlineNode[], from: number, to: number): SplitResult {
  const result: SplitResult = { before: [], selected: [], after: [] };
  let cursor = 0;
  for (const node of nodes) {
    const length = nodeTextLength(node);
    const start = cursor;
    const end = cursor + length;
    cursor = end;
    if (end <= from) {
      result.before.push(cloneWithoutPosition(node));
      continue;
    }
    if (start >= to) {
      result.after.push(cloneWithoutPosition(node));
      continue;
    }
    const split = splitNode(node, Math.max(0, from - start), Math.min(length, to - start));
    result.before.push(...split.before);
    result.selected.push(...split.selected);
    result.after.push(...split.after);
  }
  return result;
}

function comparableProperties(node: InlineNode): string {
  const clone = cloneWithoutPosition(node);
  delete clone.children;
  delete clone.value;
  return JSON.stringify(clone);
}

function normalizeNodes(nodes: InlineNode[]): InlineNode[] {
  const normalized: InlineNode[] = [];
  for (const raw of nodes) {
    const node = cloneWithoutPosition(raw);
    if (node.children) node.children = normalizeNodes(node.children);
    const previous = normalized.at(-1);
    if (previous?.type === "text" && node.type === "text") {
      previous.value = `${previous.value ?? ""}${node.value ?? ""}`;
      continue;
    }
    if (
      previous?.children &&
      node.children &&
      previous.type === node.type &&
      comparableProperties(previous) === comparableProperties(node)
    ) {
      previous.children = normalizeNodes([...previous.children, ...node.children]);
      continue;
    }
    normalized.push(node);
  }
  return normalized;
}

export function wrapAnnotationRange(
  tree: AnnotationMarkdownRoot,
  descriptor: AnnotationSelectionDescriptor,
  annotationId: AnnotationId | string,
): AnnotationMarkdownRoot {
  const clone = structuredClone(tree) as AnnotationMarkdownRoot;
  const { blocks } = validateAnnotationSelection(clone, descriptor);
  for (const { block, from, to } of blocks) {
    const split = splitNodes(block.children, from, to);
    if (split.selected.length === 0)
      throw new AnnotationSelectionError("INVALID_RANGE", "没有可写入批注的文字");
    const directive: InlineNode = {
      type: "textDirective",
      name: "annotation",
      attributes: { id: annotationId },
      children: split.selected,
    };
    block.children = normalizeNodes([...split.before, directive, ...split.after]);
  }
  return clone;
}

export function unwrapAnnotation(
  tree: AnnotationMarkdownRoot,
  annotationId: string,
): AnnotationMarkdownRoot {
  const clone = structuredClone(tree) as AnnotationMarkdownRoot;
  let matches = 0;
  const unwrapChildren = (nodes: InlineNode[]): InlineNode[] => {
    const result: InlineNode[] = [];
    for (const raw of nodes) {
      const node = cloneWithoutPosition(raw);
      if (node.children) node.children = unwrapChildren(node.children);
      if (
        node.type === "textDirective" &&
        node.name === "annotation" &&
        node.attributes?.id === annotationId
      ) {
        matches += 1;
        result.push(...(node.children ?? []));
      } else result.push(node);
    }
    return result;
  };
  const root = clone as InlineNode;
  root.children = unwrapChildren(root.children ?? []);
  if (matches === 0) throw new AnnotationSelectionError("INVALID_RANGE", "批注锚点不存在或不唯一");
  return clone;
}
