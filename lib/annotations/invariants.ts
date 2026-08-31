import type { Nodes, Root } from "mdast";

import { parseAnnotationMarkdown } from "./markdown.ts";
import { isAttachmentAssetHref } from "./inline-policy.ts";

export type AnnotationInvariantIssueCode =
  | "DUPLICATE"
  | "EMPTY"
  | "MULTI_BLOCK"
  | "OVERLAP"
  | "NESTED"
  | "INVALID_BLOCK"
  | "UNKNOWN_ID"
  | "MISSING_ACTIVE_ID";

export type CanonicalAnnotationAnchor = {
  annotationId: string;
  text: string;
  blockIndex: number;
};

export type CanonicalAnnotationAnchorState = CanonicalAnnotationAnchor & {
  blockType: string;
  inlineStructure: string;
};

export type AnnotationInvariantIssue = {
  code: AnnotationInvariantIssueCode;
  annotationId: string | null;
};

export type AnnotationDocumentValidation = {
  ok: boolean;
  anchors: CanonicalAnnotationAnchor[];
  issues: AnnotationInvariantIssue[];
};

type MarkdownNode = Nodes & {
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  title?: string | null;
};

const allowedParagraphParents = new Set(["root", "listItem", "blockquote"]);
const allowedInlineContainers = new Set(["strong", "emphasis", "delete", "link"]);

function annotationId(node: MarkdownNode): string | null {
  const id = node.attributes?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function isAnnotationDirective(node: MarkdownNode): boolean {
  return node.name === "annotation" && ["textDirective", "leafDirective", "containerDirective"].includes(node.type);
}

function inlineText(node: MarkdownNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return node.children?.map(inlineText).join("") ?? "";
}

function inlineShape(node: MarkdownNode): unknown {
  if (node.type === "text") return [node.type, node.value ?? ""];
  const attributes = node.type === "link" ? [node.url ?? "", node.title ?? null] : null;
  return [node.type, attributes, node.children?.map(inlineShape) ?? []];
}

function hasUnsupportedInline(node: MarkdownNode): boolean {
  if (node.type === "text") return false;
  if (isAnnotationDirective(node)) return node.children?.some(hasUnsupportedInline) ?? false;
  if (node.type === "link" && isAttachmentAssetHref(node.url)) return true;
  if (!allowedInlineContainers.has(node.type)) return true;
  return node.children?.some(hasUnsupportedInline) ?? false;
}

function supportedBlock(node: MarkdownNode, parentType: string | null): boolean {
  return (node.type === "heading" && parentType === "root")
    || (node.type === "paragraph" && parentType !== null && allowedParagraphParents.has(parentType));
}

function scan(markdown: string) {
  const tree = parseAnnotationMarkdown(markdown) as Root as MarkdownNode;
  const anchors: CanonicalAnnotationAnchor[] = [];
  const anchorStates: CanonicalAnnotationAnchorState[] = [];
  const issues: AnnotationInvariantIssue[] = [];
  const seenIds: string[] = [];
  let blockIndex = -1;
  let nestedReported = false;

  const addIssue = (code: AnnotationInvariantIssueCode, id: string | null) => {
    if (!issues.some((issue) => issue.code === code && issue.annotationId === id)) issues.push({ code, annotationId: id });
  };

  const visit = (
    node: MarkdownNode,
    parentType: string | null,
    currentBlock: number | null,
    currentBlockType: string | null,
    annotationDepth: number,
  ) => {
    let nextBlock = currentBlock;
    let nextBlockType = currentBlockType;
    if (supportedBlock(node, parentType)) {
      blockIndex += 1;
      nextBlock = blockIndex;
      nextBlockType = node.type;
    }

    if (isAnnotationDirective(node)) {
      const id = annotationId(node);
      if (id) seenIds.push(id);
      if (!id) addIssue("UNKNOWN_ID", null);

      if (annotationDepth > 0) {
        if (!nestedReported) addIssue("NESTED", id);
        nestedReported = true;
        return;
      }
      if (node.type === "containerDirective") {
        addIssue("MULTI_BLOCK", id);
        return;
      }
      const text = inlineText(node);
      if (node.type !== "textDirective" || nextBlock === null || hasUnsupportedInline(node)) addIssue("INVALID_BLOCK", id);
      else if (!text.trim()) addIssue("EMPTY", id);
      else if (id) {
        const anchor = { annotationId: id, text, blockIndex: nextBlock };
        anchors.push(anchor);
        anchorStates.push({
          ...anchor,
          blockType: nextBlockType ?? "unknown",
          inlineStructure: JSON.stringify(node.children?.map(inlineShape) ?? []),
        });
      }

      node.children?.forEach((child) => visit(child, node.type, nextBlock, nextBlockType, annotationDepth + 1));
      return;
    }

    node.children?.forEach((child) => visit(child, node.type, nextBlock, nextBlockType, annotationDepth));
  };

  visit(tree, null, null, null, 0);
  return { anchors, anchorStates, issues, seenIds };
}

export function scanCanonicalAnnotationAnchors(markdown: string): CanonicalAnnotationAnchor[] {
  return scan(markdown).anchors;
}

export function scanCanonicalAnnotationAnchorStates(markdown: string): CanonicalAnnotationAnchorState[] {
  return scan(markdown).anchorStates;
}

export function validateCanonicalAnnotationDocument(
  markdown: string,
  knownIds: Iterable<string>,
  requiredIds: Iterable<string> = knownIds,
): AnnotationDocumentValidation {
  const { anchors, issues, seenIds } = scan(markdown);
  const known = new Set(knownIds);
  const required = new Set(requiredIds);
  const counts = new Map<string, number>();
  for (const id of seenIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  for (const [id, count] of counts) {
    if (count > 1) issues.push({ code: "DUPLICATE", annotationId: id });
    if (!known.has(id)) issues.push({ code: "UNKNOWN_ID", annotationId: id });
  }
  for (const id of required) {
    if (!counts.has(id)) issues.push({ code: "MISSING_ACTIVE_ID", annotationId: id });
  }

  const priority: Record<AnnotationInvariantIssueCode, number> = {
    DUPLICATE: 0,
    EMPTY: 1,
    MULTI_BLOCK: 2,
    OVERLAP: 3,
    NESTED: 4,
    INVALID_BLOCK: 5,
    UNKNOWN_ID: 6,
    MISSING_ACTIVE_ID: 7,
  };
  issues.sort((left, right) => priority[left.code] - priority[right.code]
    || (left.annotationId ?? "").localeCompare(right.annotationId ?? ""));

  return { ok: issues.length === 0, anchors, issues };
}
