import type { Nodes, Root } from "mdast";

import { isAttachmentAssetHref } from "./inline-policy.ts";
import { parseAnnotationMarkdown } from "./markdown.ts";
import { collectAnnotationDocumentBlocks, isCanonicalMultiBlockAnnotationSpan } from "./span.ts";

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

type PhysicalAnchor = CanonicalAnnotationAnchorState & {
  documentIndex: number;
  from: number;
  to: number;
  firstVisibleFrom: number;
  lastVisibleTo: number;
};

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

function containsAnnotationDirective(node: MarkdownNode): boolean {
  return node.children?.some((child) => isAnnotationDirective(child) || containsAnnotationDirective(child)) ?? false;
}

function visibleBounds(text: string) {
  const first = text.search(/\S/u);
  if (first < 0) return { firstVisibleFrom: 0, lastVisibleTo: 0 };
  let last = text.length;
  while (last > first && /\s/u.test(text[last - 1]!)) last -= 1;
  return { firstVisibleFrom: first, lastVisibleTo: last };
}

function scan(markdown: string) {
  const tree = parseAnnotationMarkdown(markdown) as Root as MarkdownNode;
  const entries = collectAnnotationDocumentBlocks(tree);
  const anchors: CanonicalAnnotationAnchor[] = [];
  const anchorStates: CanonicalAnnotationAnchorState[] = [];
  const physicalAnchors: PhysicalAnchor[] = [];
  const issues: AnnotationInvariantIssue[] = [];
  const seenIds: string[] = [];
  const handled = new Set<MarkdownNode>();
  let nestedReported = false;

  const addIssue = (code: AnnotationInvariantIssueCode, id: string | null) => {
    if (!issues.some((issue) => issue.code === code && issue.annotationId === id)) issues.push({ code, annotationId: id });
  };

  for (const entry of entries.filter((candidate) => candidate.supported)) {
    const block = entry.node as MarkdownNode;
    const bounds = visibleBounds(inlineText(block));
    const validInlineBlock = !(block.children?.some(hasUnsupportedInline) ?? false);
    let cursor = 0;

    const visitInline = (node: MarkdownNode, annotationDepth: number) => {
      if (node.type === "text" || node.type === "inlineCode") {
        cursor += (node.value ?? "").length;
        return;
      }
      if (isAnnotationDirective(node)) {
        handled.add(node);
        const id = annotationId(node);
        if (id) seenIds.push(id);
        else addIssue("UNKNOWN_ID", null);
        const start = cursor;
        const hasNested = containsAnnotationDirective(node);
        node.children?.forEach((child) => visitInline(child, annotationDepth + 1));
        const end = cursor;
        if (annotationDepth > 0 || hasNested) {
          if (!nestedReported) addIssue("NESTED", id);
          nestedReported = true;
          return;
        }
        const text = inlineText(node);
        if (node.type !== "textDirective" || !validInlineBlock || hasUnsupportedInline(node)) addIssue("INVALID_BLOCK", id);
        else if (!text.trim()) addIssue("EMPTY", id);
        else if (id) {
          physicalAnchors.push({
            annotationId: id,
            text,
            blockIndex: entry.eligibleOrdinal!,
            documentIndex: entry.documentIndex,
            blockType: block.type,
            inlineStructure: JSON.stringify(node.children?.map(inlineShape) ?? []),
            from: start,
            to: end,
            ...bounds,
          });
        }
        return;
      }
      node.children?.forEach((child) => visitInline(child, annotationDepth));
    };

    block.children?.forEach((child) => visitInline(child, 0));
  }

  const visitUnhandled = (node: MarkdownNode, annotationDepth: number) => {
    if (isAnnotationDirective(node)) {
      if (handled.has(node)) return;
      const id = annotationId(node);
      if (id) seenIds.push(id);
      else addIssue("UNKNOWN_ID", null);
      if (annotationDepth > 0) {
        if (!nestedReported) addIssue("NESTED", id);
        nestedReported = true;
      } else {
        addIssue(node.type === "containerDirective" ? "MULTI_BLOCK" : "INVALID_BLOCK", id);
      }
      node.children?.forEach((child) => visitUnhandled(child, annotationDepth + 1));
      return;
    }
    node.children?.forEach((child) => visitUnhandled(child, annotationDepth));
  };
  visitUnhandled(tree, 0);

  const groups = new Map<string, PhysicalAnchor[]>();
  for (const anchor of physicalAnchors) groups.set(anchor.annotationId, [...(groups.get(anchor.annotationId) ?? []), anchor]);
  const orderedGroups = [...groups.entries()].sort((left, right) => left[1][0]!.documentIndex - right[1][0]!.documentIndex);
  for (const [id, rawSegments] of orderedGroups) {
    const segments = [...rawSegments].sort((left, right) => left.documentIndex - right.documentIndex || left.from - right.from);
    const byBlock = new Map<number, number>();
    for (const segment of segments) byBlock.set(segment.documentIndex, (byBlock.get(segment.documentIndex) ?? 0) + 1);
    const duplicate = [...byBlock.values()].some((count) => count > 1);
    if (duplicate) addIssue("DUPLICATE", id);
    else if (!isCanonicalMultiBlockAnnotationSpan(segments.map((segment) => ({
      blockIndex: segment.documentIndex,
      from: segment.from,
      to: segment.to,
      firstVisibleFrom: segment.firstVisibleFrom,
      lastVisibleTo: segment.lastVisibleTo,
    })))) addIssue("MULTI_BLOCK", id);

    const anchor = {
      annotationId: id,
      text: segments.map((segment) => segment.text).join("\n\n"),
      blockIndex: segments[0]!.blockIndex,
    };
    anchors.push(anchor);
    anchorStates.push({
      ...anchor,
      blockType: segments.map((segment) => segment.blockType).join("\n"),
      inlineStructure: JSON.stringify(segments.map((segment) => segment.inlineStructure)),
    });
  }

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
  requiredIds?: Iterable<string>,
): AnnotationDocumentValidation {
  const { anchors, issues, seenIds } = scan(markdown);
  const known = new Set(knownIds);
  const required = new Set(requiredIds ?? known);
  const present = new Set(seenIds);

  for (const id of present) if (!known.has(id)) issues.push({ code: "UNKNOWN_ID", annotationId: id });
  for (const id of required) if (!present.has(id)) issues.push({ code: "MISSING_ACTIVE_ID", annotationId: id });

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
