import { createAnnotationId as createNativeAnnotationId } from "../annotations/policy.ts";
import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { escapeMarkdownLiteral } from "./markdown.ts";
import { DocxImportError } from "./types.ts";
import type {
  ImportedReply,
  ImportedThread,
  ImportWarning,
  ImportWarningCode,
  InlineSegment,
  SkippedThread,
} from "./types.ts";
import type { WalkedCommentRange, WalkedDocument } from "./walker.ts";
import {
  type OrderedXmlNodes,
  xmlAttr,
  xmlChild,
  xmlChildren,
  xmlText,
} from "./xml.ts";

export interface WordComment {
  sourceCommentId: string;
  sourceAuthorName: string;
  sourceInitials?: string;
  sourceCreatedAt?: string;
  sourceDocumentOrder: number;
  sourceResolved: boolean;
  bodyMarkdown: string;
  paraId?: string;
  parentParaId?: string;
  parentParaIds?: readonly string[];
  parentSourceCommentId?: string;
  commentExBound?: boolean;
}

export interface WordCommentCatalog {
  comments: WordComment[];
  hasCommentsExtended: boolean;
  duplicateParaIds: ReadonlySet<string>;
}

export type WordThreadInvalidReason =
  | "MISSING_PARENT"
  | "DUPLICATE_PARA_ID"
  | "UNBOUND_COMMENT_EX"
  | "CYCLE";

export interface WordThread {
  root: WordComment;
  replies: WordComment[];
  invalidReason?: WordThreadInvalidReason;
}

export interface AnnotationIdFactories {
  createAnnotationId?: (sourceCommentId: string) => string;
  createReplyId?: (sourceCommentId: string) => string;
}

export interface ResolvedAnnotationThreads {
  accepted: ImportedThread[];
  skipped: SkippedThread[];
  warnings: ImportWarning[];
}

interface CommentExtendedRecord {
  parentParaId?: string;
  resolved: boolean;
}

export function parseWordComments(
  commentsXml: OrderedXmlNodes,
  commentsExtendedXml?: OrderedXmlNodes,
): WordCommentCatalog {
  const commentsRoot = xmlChild(commentsXml, "comments");
  const commentNodes = commentsRoot ? xmlChildren(commentsRoot, "comment") : [];
  if (commentNodes.length > DOCX_IMPORT_LIMITS.commentsAndReplies) {
    throw new DocxImportError(
      "COMMENT_LIMIT",
      `DOCX comments exceed the ${DOCX_IMPORT_LIMITS.commentsAndReplies}-item limit`,
      { count: commentNodes.length },
    );
  }
  const seenCommentIds = new Set<string>();
  for (const node of commentNodes) {
    const sourceCommentId = xmlAttr(node, "id");
    if (!sourceCommentId) continue;
    if (seenCommentIds.has(sourceCommentId)) {
      throw new DocxImportError(
        "COMMENT_ID_DUPLICATE",
        "DOCX comments contain a duplicate source comment ID",
        { sourceCommentId },
      );
    }
    seenCommentIds.add(sourceCommentId);
  }
  const extendedRoot = commentsExtendedXml
    ? xmlChild(commentsExtendedXml, "commentsEx")
    : undefined;
  const extendedByParaId = new Map<string, CommentExtendedRecord[]>();

  for (const node of extendedRoot ? xmlChildren(extendedRoot, "commentEx") : []) {
    const paraId = xmlAttr(node, "paraId");
    if (!paraId) continue;
    const records = extendedByParaId.get(paraId) ?? [];
    records.push({
      parentParaId: xmlAttr(node, "paraIdParent"),
      resolved: onOff(xmlAttr(node, "done")),
    });
    extendedByParaId.set(paraId, records);
  }

  const comments = commentNodes.flatMap((node, sourceDocumentOrder) => {
    const sourceCommentId = xmlAttr(node, "id");
    if (!sourceCommentId) return [];
    const paragraphs = xmlChildren(node, "p");
    const paraId = paragraphs.length > 0 ? xmlAttr(paragraphs.at(-1)!, "paraId") : undefined;
    const extendedRecords = paraId ? extendedByParaId.get(paraId) ?? [] : [];
    const extended = extendedRecords[0];
    const parentParaIds = [...new Set(extendedRecords.flatMap((record) =>
      record.parentParaId ? [record.parentParaId] : []))];
    return [{
      sourceCommentId,
      sourceAuthorName: xmlAttr(node, "author") ?? "",
      sourceInitials: xmlAttr(node, "initials"),
      sourceCreatedAt: xmlAttr(node, "date"),
      sourceDocumentOrder,
      sourceResolved: extended?.resolved ?? false,
      bodyMarkdown: paragraphs.map((paragraph) => escapeMarkdownLiteral(xmlText(paragraph).trim())).join("\n\n"),
      paraId,
      parentParaId: extended?.parentParaId,
      ...(parentParaIds.length > 0 ? { parentParaIds } : {}),
      commentExBound: commentsExtendedXml ? Boolean(paraId && extendedByParaId.get(paraId)?.length === 1) : undefined,
    } satisfies WordComment];
  });

  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (comment.paraId) counts.set(comment.paraId, (counts.get(comment.paraId) ?? 0) + 1);
  }
  const duplicateParaIds = new Set(
    [...counts].filter(([, count]) => count > 1).map(([paraId]) => paraId),
  );
  for (const [paraId, records] of extendedByParaId) {
    if (records.length > 1) duplicateParaIds.add(paraId);
  }

  return {
    comments,
    hasCommentsExtended: commentsExtendedXml !== undefined,
    duplicateParaIds,
  };
}

export function buildWordThreads(catalog: WordCommentCatalog): WordThread[] {
  if (!catalog.hasCommentsExtended) {
    return catalog.comments.map((root) => ({ root, replies: [] }));
  }

  const byId = new Map(catalog.comments.map((comment) => [comment.sourceCommentId, { ...comment }]));
  const idsByParaId = new Map<string, string[]>();
  for (const comment of byId.values()) {
    if (!comment.paraId) continue;
    const ids = idsByParaId.get(comment.paraId) ?? [];
    ids.push(comment.sourceCommentId);
    idsByParaId.set(comment.paraId, ids);
  }

  const invalidById = new Map<string, WordThreadInvalidReason>();
  for (const comment of byId.values()) {
    if (comment.commentExBound === false) {
      invalidById.set(comment.sourceCommentId, "UNBOUND_COMMENT_EX");
    }
    if (comment.paraId && catalog.duplicateParaIds.has(comment.paraId)) {
      invalidById.set(comment.sourceCommentId, "DUPLICATE_PARA_ID");
    }
    if (!comment.parentParaId || comment.commentExBound === false) continue;
    const parentIds = idsByParaId.get(comment.parentParaId) ?? [];
    if (parentIds.length !== 1) {
      invalidById.set(
        comment.sourceCommentId,
        parentIds.length === 0 ? "MISSING_PARENT" : "DUPLICATE_PARA_ID",
      );
    } else {
      comment.parentSourceCommentId = parentIds[0];
    }
  }

  const adjacency = new Map<string, Set<string>>();
  const connect = (left: string, right: string) => {
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left)!.add(right);
    adjacency.get(right)!.add(left);
  };
  for (const id of byId.keys()) adjacency.set(id, new Set());
  for (const comment of byId.values()) {
    if (comment.parentSourceCommentId) {
      connect(comment.sourceCommentId, comment.parentSourceCommentId);
    } else {
      const parentParaIds = comment.parentParaIds
        ?? (comment.parentParaId ? [comment.parentParaId] : []);
      for (const parentParaId of parentParaIds) {
        for (const parentId of idsByParaId.get(parentParaId) ?? []) {
          connect(comment.sourceCommentId, parentId);
        }
      }
    }
  }
  for (const paraId of catalog.duplicateParaIds) {
    const ids = idsByParaId.get(paraId) ?? [];
    for (let index = 1; index < ids.length; index += 1) connect(ids[0], ids[index]);
  }

  const visited = new Set<string>();
  const threads: WordThread[] = [];
  for (const comment of byId.values()) {
    if (visited.has(comment.sourceCommentId)) continue;
    const componentIds: string[] = [];
    const pending = [comment.sourceCommentId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      componentIds.push(id);
      pending.push(...(adjacency.get(id) ?? []));
    }
    const component = componentIds
      .map((id) => byId.get(id)!)
      .sort(compareCommentOrder);
    const invalidReason = component
      .map((member) => invalidById.get(member.sourceCommentId))
      .find((reason) => reason === "DUPLICATE_PARA_ID")
      ?? component.map((member) => invalidById.get(member.sourceCommentId)).find(Boolean)
      ?? (hasParentCycle(component, byId) ? "CYCLE" : undefined);
    const roots = component.filter((member) => !member.parentSourceCommentId);
    const root = !invalidReason && roots.length === 1 ? roots[0] : component[0];
    threads.push({
      root,
      replies: component.filter((member) => member.sourceCommentId !== root.sourceCommentId),
      ...(invalidReason || roots.length !== 1 ? { invalidReason: invalidReason ?? "CYCLE" } : {}),
    });
  }
  return threads.sort((left, right) => compareCommentOrder(left.root, right.root));
}

export function resolveAnnotationThreads(
  walked: WalkedDocument,
  threads: WordThread[],
  factories: AnnotationIdFactories = {},
): ResolvedAnnotationThreads {
  const createAnnotationId = factories.createAnnotationId
    ?? (() => createNativeAnnotationId());
  const createReplyId = factories.createReplyId
    ?? (() => crypto.randomUUID());
  const traces = new Map(walked.commentRanges.map((range) => [range.sourceCommentId, range]));
  const supportedBlocks = supportedTextBlocks(walked);
  const catalogIds = new Set(threads.flatMap((thread) => [
    thread.root.sourceCommentId,
    ...thread.replies.map((reply) => reply.sourceCommentId),
  ]));
  const skipped: SkippedThread[] = [];
  const candidates: Array<{
    thread: WordThread;
    blockId: string;
    start: number;
    end: number;
  }> = [];

  for (const thread of threads) {
    if (thread.invalidReason) {
      skipped.push(skipWordThread(thread, "ANNOTATION_THREAD_SKIPPED", {
        reason: thread.invalidReason,
      }));
      continue;
    }
    const trace = traces.get(thread.root.sourceCommentId);
    if (!trace) {
      skipped.push(skipWordThread(thread, "ANNOTATION_ORPHAN_DEFINITION"));
      continue;
    }
    const legality = legalRange(trace, supportedBlocks.segments);
    if ("code" in legality) {
      skipped.push(skipWordThread(thread, legality.code));
      continue;
    }
    candidates.push({ thread, ...legality });
  }

  for (const trace of walked.commentRanges) {
    if (catalogIds.has(trace.sourceCommentId)) continue;
    skipped.push({
      sourceCommentId: trace.sourceCommentId,
      sourceDocumentOrder: trace.firstDocumentOrder,
      warning: warning("ANNOTATION_ORPHAN_DEFINITION", trace.sourceCommentId),
    });
  }

  const blockOrder = supportedBlocks.order;
  candidates.sort((left, right) =>
    (blockOrder.get(left.blockId) ?? Number.MAX_SAFE_INTEGER)
    - (blockOrder.get(right.blockId) ?? Number.MAX_SAFE_INTEGER)
    || left.start - right.start
    || (right.end - right.start) - (left.end - left.start)
    || compareSourceCommentId(left.thread.root.sourceCommentId, right.thread.root.sourceCommentId));

  const acceptedCandidates: typeof candidates = [];
  for (const candidate of candidates) {
    const conflict = acceptedCandidates.find((accepted) =>
      accepted.blockId === candidate.blockId
      && candidate.start < accepted.end
      && accepted.start < candidate.end);
    if (conflict) {
      skipped.push(skipWordThread(candidate.thread, "ANNOTATION_OVERLAP_SKIPPED", {
        conflictsWithSourceCommentId: conflict.thread.root.sourceCommentId,
      }));
    } else {
      acceptedCandidates.push(candidate);
    }
  }

  const accepted = acceptedCandidates.map(({ thread, blockId, start, end }) => ({
    annotationId: createAnnotationId(thread.root.sourceCommentId),
    sourceCommentId: thread.root.sourceCommentId,
    blockId,
    blockLocalStart: start,
    blockLocalEnd: end,
    sourceAuthorName: thread.root.sourceAuthorName,
    sourceInitials: thread.root.sourceInitials,
    sourceCreatedAt: thread.root.sourceCreatedAt,
    sourceDocumentOrder: thread.root.sourceDocumentOrder,
    sourceResolved: thread.root.sourceResolved,
    bodyMarkdown: thread.root.bodyMarkdown,
    replies: thread.replies.map((reply): ImportedReply => ({
      replyId: createReplyId(reply.sourceCommentId),
      sourceCommentId: reply.sourceCommentId,
      parentSourceCommentId: reply.parentSourceCommentId!,
      sourceAuthorName: reply.sourceAuthorName,
      sourceInitials: reply.sourceInitials,
      sourceCreatedAt: reply.sourceCreatedAt,
      sourceDocumentOrder: reply.sourceDocumentOrder,
      sourceResolved: reply.sourceResolved,
      bodyMarkdown: reply.bodyMarkdown,
    })),
  } satisfies ImportedThread));

  skipped.sort((left, right) =>
    left.sourceDocumentOrder - right.sourceDocumentOrder
    || compareSourceCommentId(left.sourceCommentId, right.sourceCommentId));
  return { accepted, skipped, warnings: skipped.map((item) => item.warning) };
}

function legalRange(
  trace: WalkedCommentRange,
  segmentsByBlock: ReadonlyMap<string, InlineSegment[]>,
): { blockId: string; start: number; end: number } | { code: ImportWarningCode } {
  if (trace.touchedLocations.includes("table")) return { code: "ANNOTATION_TABLE_UNSUPPORTED" };
  if (trace.touchedLocations.some((location) => location === "image" || location === "nonText")) {
    return { code: "ANNOTATION_NON_TEXT_RANGE" };
  }
  const starts = trace.markers.filter((marker) => marker.kind === "start");
  const ends = trace.markers.filter((marker) => marker.kind === "end");
  if (starts.length !== 1 || ends.length !== 1) return { code: "ANNOTATION_NON_TEXT_RANGE" };
  const start = starts[0];
  const end = ends[0];
  if (!start.blockId || !end.blockId || start.offset === undefined || end.offset === undefined) {
    return { code: "ANNOTATION_NON_TEXT_RANGE" };
  }
  if (start.blockId !== end.blockId) return { code: "ANNOTATION_CROSS_BLOCK" };
  if (end.offset <= start.offset) return {
    code: end.offset === start.offset ? "ANNOTATION_EMPTY_RANGE" : "ANNOTATION_NON_TEXT_RANGE",
  };
  const segments = segmentsByBlock.get(start.blockId);
  if (!segments || segments.some((segment) => segment.marks.includes("code"))) {
    return { code: "ANNOTATION_NON_TEXT_RANGE" };
  }
  return { blockId: start.blockId, start: start.offset, end: end.offset };
}

function supportedTextBlocks(walked: WalkedDocument): {
  order: Map<string, number>;
  segments: Map<string, InlineSegment[]>;
} {
  const order = new Map<string, number>();
  const segments = new Map<string, InlineSegment[]>();
  let index = 0;
  for (const block of walked.blocks) {
    if (block.type === "list") {
      for (const item of block.items) {
        order.set(item.id, index++);
        segments.set(item.id, item.segments);
      }
    } else if ("segments" in block) {
      order.set(block.id, index++);
      segments.set(block.id, block.segments);
    }
  }
  return { order, segments };
}

function skipWordThread(
  thread: WordThread,
  code: ImportWarningCode,
  payload?: Readonly<Record<string, unknown>>,
): SkippedThread {
  const comment = thread.root;
  return {
    sourceCommentId: comment.sourceCommentId,
    sourceAuthorName: comment.sourceAuthorName,
    sourceDocumentOrder: comment.sourceDocumentOrder,
    warning: warning(code, comment.sourceCommentId, {
      replyCount: thread.replies.length,
      ...payload,
    }),
  };
}

function warning(
  code: ImportWarningCode,
  sourceRef: string,
  payload?: Readonly<Record<string, unknown>>,
): ImportWarning {
  return { code, severity: "warning", sourceRef, ...(payload ? { payload } : {}) };
}

function hasParentCycle(component: WordComment[], byId: Map<string, WordComment>): boolean {
  const componentIds = new Set(component.map((comment) => comment.sourceCommentId));
  for (const comment of component) {
    const path = new Set<string>();
    let current: WordComment | undefined = comment;
    while (current && componentIds.has(current.sourceCommentId)) {
      if (path.has(current.sourceCommentId)) return true;
      path.add(current.sourceCommentId);
      current = current.parentSourceCommentId ? byId.get(current.parentSourceCommentId) : undefined;
    }
  }
  return false;
}

function compareCommentOrder(left: WordComment, right: WordComment): number {
  return left.sourceDocumentOrder - right.sourceDocumentOrder
    || compareSourceCommentId(left.sourceCommentId, right.sourceCommentId);
}

function compareSourceCommentId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function onOff(value: string | undefined): boolean {
  return value === "1" || value?.toLocaleLowerCase("en-US") === "true";
}
