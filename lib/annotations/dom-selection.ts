import type { AnnotationSelectionDescriptor } from "./types.ts";

type TextSegment = { node: Text; from: number; to: number };
export type SerializedDomBoundary = { path: number[]; offset: number };
export type SerializedDomRange = { start: SerializedDomBoundary; end: SerializedDomBoundary };

function serializeDomBoundary(root: Element, node: Node, offset: number): SerializedDomBoundary {
  if (node !== root && !root.contains(node)) throw new Error("批注选区已失效，请重新选择文字");
  const path: number[] = [];
  let current: Node = node;
  while (current !== root) {
    const parent = current.parentNode;
    if (!parent) throw new Error("批注选区已失效，请重新选择文字");
    const index = Array.prototype.indexOf.call(parent.childNodes, current) as number;
    if (index < 0) throw new Error("批注选区已失效，请重新选择文字");
    path.unshift(index);
    current = parent;
  }
  return { path, offset };
}

function restoreDomBoundary(root: Element, boundary: SerializedDomBoundary): { node: Node; offset: number } | null {
  let node: Node = root;
  for (const index of boundary.path) {
    if (!Number.isInteger(index) || index < 0 || index >= node.childNodes.length) return null;
    node = node.childNodes[index]!;
  }
  const maximumOffset = node.nodeType === 3 ? (node as Text).data.length : node.childNodes.length;
  if (!Number.isInteger(boundary.offset) || boundary.offset < 0 || boundary.offset > maximumOffset) return null;
  return { node, offset: boundary.offset };
}

export function serializeDomRange(root: Element, range: Range): SerializedDomRange {
  return {
    start: serializeDomBoundary(root, range.startContainer, range.startOffset),
    end: serializeDomBoundary(root, range.endContainer, range.endOffset),
  };
}

export function restoreSerializedDomRange(root: Element, serialized: SerializedDomRange): Range | null {
  const start = restoreDomBoundary(root, serialized.start);
  const end = restoreDomBoundary(root, serialized.end);
  if (!start || !end) return null;
  try {
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

function directChildWithTag(element: Element, tagName: string): boolean {
  return Array.from(element.children).some((child) => child.tagName === tagName);
}

function eligibleDomBlocks(root: Element): Element[] {
  return Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li")).filter((element) => {
    const tagName = element.tagName;
    if (/^H[1-6]$/.test(tagName)) return element.parentElement === root;
    if (tagName === "P") {
      const parent = element.parentElement;
      return parent === root || parent?.tagName === "LI" || parent?.tagName === "BLOCKQUOTE";
    }
    return tagName === "LI" && !directChildWithTag(element, "P");
  });
}

function blockForBoundary(root: Element, node: Node): Element | null {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  if (!element || !root.contains(element)) return null;
  return eligibleDomBlocks(root).findLast((candidate) => candidate === element || candidate.contains(element)) ?? null;
}

function excludedFromTightList(root: Element, text: Text): boolean {
  if (root.tagName !== "LI") return false;
  let current = text.parentElement;
  while (current && current !== root) {
    if (["UL", "OL", "P", "BLOCKQUOTE", "TABLE", "PRE"].includes(current.tagName)) return true;
    current = current.parentElement;
  }
  return false;
}

function textSegments(block: Element): TextSegment[] {
  const walker = block.ownerDocument.createTreeWalker(block, 4);
  const segments: TextSegment[] = [];
  let cursor = 0;
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (!excludedFromTightList(block, node)) {
      const length = node.data.length;
      segments.push({ node, from: cursor, to: cursor + length });
      cursor += length;
    }
    current = walker.nextNode();
  }
  return segments;
}

function boundaryOffset(segments: TextSegment[], node: Node, offset: number): number {
  if (node.nodeType !== 3) throw new Error("批注选区无效，请重新选择文字");
  const segment = segments.find((candidate) => candidate.node === node);
  if (!segment || offset < 0 || offset > segment.node.data.length) throw new Error("批注选区无效，请重新选择文字");
  return segment.from + offset;
}

function unsupportedAncestor(node: Text, block: Element): boolean {
  let current = node.parentElement;
  while (current && current !== block) {
    if (["CODE", "PRE", "TABLE"].includes(current.tagName)) return true;
    if (current.tagName === "A" && current.getAttribute("href")?.startsWith("/api/assets/")) return true;
    current = current.parentElement;
  }
  return false;
}

export function describeAnnotationDomRange(root: Element, range: Range): AnnotationSelectionDescriptor {
  if (range.collapsed) throw new Error("请选择至少一个非空白字符");
  const startBlock = blockForBoundary(root, range.startContainer);
  const endBlock = blockForBoundary(root, range.endContainer);
  if (!startBlock || !endBlock) throw new Error("所选内容暂不支持正文批注");
  const blocks = eligibleDomBlocks(root);
  const blockOrdinal = blocks.indexOf(startBlock);
  const endBlockOrdinal = blocks.indexOf(endBlock);
  if (blockOrdinal < 0 || endBlockOrdinal < blockOrdinal) throw new Error("所选内容暂不支持正文批注");

  const intersects = (element: Element) => {
    try { return range.intersectsNode(element); } catch { return false; }
  };
  const structuralBlocks = root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, pre, table, hr");
  if ([...structuralBlocks].some((element) => !blocks.includes(element) && intersects(element))) {
    throw new Error("跨段批注不能穿过代码块、表格或其他不支持的内容");
  }
  if ([...root.querySelectorAll("pre, table, hr, img, code, a[href^='/api/assets/']")].some(intersects)) {
    throw new Error("所选内容包含暂不支持的格式");
  }

  const selected = blocks.slice(blockOrdinal, endBlockOrdinal + 1).map((block, index, items) => {
    const segments = textSegments(block);
    const from = index === 0 ? boundaryOffset(segments, range.startContainer, range.startOffset) : 0;
    const to = index === items.length - 1 ? boundaryOffset(segments, range.endContainer, range.endOffset) : segments.at(-1)?.to ?? 0;
    if (to <= from) throw new Error("批注选区无效，请重新选择文字");
    const selectedSegments = segments.filter((segment) => segment.from < to && segment.to > from);
    if (selectedSegments.some((segment) => unsupportedAncestor(segment.node, block))) throw new Error("所选内容包含暂不支持的格式");
    if (selectedSegments.some((segment) => segment.node.parentElement?.closest(".annotation-range"))) throw new Error("所选内容与已有批注重叠，无法再次添加批注");
    const text = segments.map((segment) => segment.node.data).join("").slice(from, to);
    if (!text.trim()) throw new Error("请选择至少一个非空白字符");
    return { from, to, text };
  });
  return {
    blockOrdinal,
    endBlockOrdinal,
    blockTextFrom: selected[0]!.from,
    blockTextTo: selected.at(-1)!.to,
    selectedText: selected.map((item) => item.text).join("\n\n"),
  };
}
