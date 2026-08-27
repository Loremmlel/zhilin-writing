import type { AnnotationSelectionDescriptor } from "./types.ts";

type TextSegment = { node: Text; from: number; to: number };

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
  return eligibleDomBlocks(root).find((candidate) => candidate === element || candidate.contains(element)) ?? null;
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
  if (startBlock !== endBlock) throw new Error("批注只能位于同一个文本块内");
  const blocks = eligibleDomBlocks(root);
  const blockOrdinal = blocks.indexOf(startBlock);
  if (blockOrdinal < 0) throw new Error("所选内容暂不支持正文批注");
  const segments = textSegments(startBlock);
  const from = boundaryOffset(segments, range.startContainer, range.startOffset);
  const to = boundaryOffset(segments, range.endContainer, range.endOffset);
  if (to <= from) throw new Error("批注选区无效，请重新选择文字");
  const selectedSegments = segments.filter((segment) => segment.from < to && segment.to > from);
  if (selectedSegments.some((segment) => unsupportedAncestor(segment.node, startBlock))) throw new Error("所选内容包含暂不支持的格式");
  if (selectedSegments.some((segment) => segment.node.parentElement?.closest(".annotation-range"))) throw new Error("所选内容与已有批注重叠，无法再次添加批注");
  const blockText = segments.map((segment) => segment.node.data).join("");
  const selectedText = blockText.slice(from, to);
  if (!selectedText.trim()) throw new Error("请选择至少一个非空白字符");
  return { blockOrdinal, endBlockOrdinal: blockOrdinal, blockTextFrom: from, blockTextTo: to, selectedText };
}
