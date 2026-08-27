import type { Nodes, Root } from "mdast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import type { AnnotationMarkdownRoot } from "./types.ts";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkStringify, { bullet: "-", emphasis: "*", strong: "*", fences: true });

type TraversableNode = Nodes & {
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: TraversableNode[];
  value?: string;
  alt?: string;
};

const blockTypes = new Set(["heading", "paragraph", "listItem", "tableCell", "blockquote", "code"]);

function visit(node: TraversableNode, callback: (node: TraversableNode) => void) {
  callback(node);
  node.children?.forEach((child) => visit(child, callback));
}

export function parseAnnotationMarkdown(markdown: string): AnnotationMarkdownRoot {
  return processor.parse(markdown) as Root;
}

export function stringifyAnnotationMarkdown(tree: AnnotationMarkdownRoot): string {
  return processor.stringify(tree);
}

export function collectAnnotationIds(tree: AnnotationMarkdownRoot): string[] {
  const ids: string[] = [];
  visit(tree as TraversableNode, (node) => {
    if (node.type !== "textDirective" || node.name !== "annotation") return;
    const id = node.attributes?.id;
    if (typeof id === "string") ids.push(id);
  });
  return ids;
}

export function hasAnnotationDirective(tree: AnnotationMarkdownRoot): boolean {
  let found = false;
  visit(tree as TraversableNode, (node) => {
    if (node.type === "textDirective" && node.name === "annotation") found = true;
  });
  return found;
}

export function visiblePostText(tree: AnnotationMarkdownRoot): string {
  const chunks: string[] = [];
  visit(tree as TraversableNode, (node) => {
    if (["text", "inlineCode", "code"].includes(node.type) && node.value) chunks.push(node.value);
    if (node.type === "image" && node.alt) chunks.push(node.alt);
    if (blockTypes.has(node.type)) chunks.push(" ");
  });
  return chunks.join("").replace(/\s+/g, " ").trim();
}
