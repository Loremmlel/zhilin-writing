import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";

import {
  analyzeAnnotationRanges,
  type AnnotationRangeIssueCode,
  type EditorAnnotationEndpoint,
  type EditorAnnotationRange,
} from "./annotation-ranges.ts";

export type AnnotationImpactReasonCode =
  | "LEFT_ENDPOINT_REMOVED"
  | "RIGHT_ENDPOINT_REMOVED"
  | "EMPTY"
  | "REMOVED"
  | "MULTI_BLOCK"
  | "DUPLICATE"
  | "OVERLAP"
  | "NESTED"
  | "INVALID_BLOCK";

export type AnnotationImpactReason = {
  annotationId: string;
  code: AnnotationImpactReasonCode;
};

export type AnnotationGuardResult =
  | { kind: "SAFE" }
  | {
      kind: "ANNOTATION_IMPACT";
      affectedAnnotationIds: string[];
      destructive: true;
      reasons: AnnotationImpactReason[];
    };

function rangesById(ranges: EditorAnnotationRange[]): Map<string, EditorAnnotationRange[]> {
  const result = new Map<string, EditorAnnotationRange[]>();
  for (const range of ranges) result.set(range.annotationId, [...(result.get(range.annotationId) ?? []), range]);
  return result;
}

function endpointSurvives(endpoint: EditorAnnotationEndpoint, after: EditorAnnotationRange, transaction: Transaction): boolean {
  const from = transaction.mapping.mapResult(endpoint.from, 1);
  const to = transaction.mapping.mapResult(endpoint.to, -1);
  if (from.deleted || to.deleted || from.pos >= to.pos) return false;
  if (from.pos < after.from || to.pos > after.to) return false;
  return transaction.doc.textBetween(from.pos, to.pos, "", "") === endpoint.text;
}

function boundarySurvives(
  position: number,
  association: -1 | 1,
  expectedPosition: number,
  transaction: Transaction,
): boolean {
  const mapped = transaction.mapping.mapResult(position, association);
  return !mapped.deleted && mapped.pos === expectedPosition;
}

export function inspectAnnotationTransaction(
  beforeDoc: ProseMirrorNode,
  transaction: Transaction,
): AnnotationGuardResult {
  if (!transaction.docChanged) return { kind: "SAFE" };

  const before = analyzeAnnotationRanges(beforeDoc);
  const after = analyzeAnnotationRanges(transaction.doc);
  const beforeById = rangesById(before.ranges);
  const afterById = rangesById(after.ranges);
  const structuralIds = new Set(after.issues.map((issue) => issue.annotationId));
  const reasons: AnnotationImpactReason[] = after.issues.map((issue) => ({
    annotationId: issue.annotationId,
    code: issue.code as AnnotationRangeIssueCode,
  }));

  for (const [annotationId, beforeRanges] of beforeById) {
    const afterRanges = afterById.get(annotationId) ?? [];
    if (afterRanges.length === 0) {
      reasons.push({ annotationId, code: "REMOVED" });
      continue;
    }
    if (structuralIds.has(annotationId) || beforeRanges.length !== 1 || afterRanges.length !== 1) continue;
    const [previous] = beforeRanges;
    const [next] = afterRanges;
    if (!boundarySurvives(previous.from, 1, next.from, transaction)
      || !endpointSurvives(previous.firstEndpoint, next, transaction)) {
      reasons.push({ annotationId, code: "LEFT_ENDPOINT_REMOVED" });
    }
    if (!boundarySurvives(previous.to, -1, next.to, transaction)
      || !endpointSurvives(previous.lastEndpoint, next, transaction)) {
      reasons.push({ annotationId, code: "RIGHT_ENDPOINT_REMOVED" });
    }
  }

  const uniqueReasons: AnnotationImpactReason[] = [];
  for (const reason of reasons) {
    if (!uniqueReasons.some((candidate) => candidate.annotationId === reason.annotationId && candidate.code === reason.code)) {
      uniqueReasons.push(reason);
    }
  }
  if (uniqueReasons.length === 0) return { kind: "SAFE" };

  const positionById = new Map<string, number>();
  for (const range of [...before.ranges, ...after.ranges]) {
    if (!positionById.has(range.annotationId)) positionById.set(range.annotationId, range.from);
  }
  const codePriority: Record<AnnotationImpactReasonCode, number> = {
    LEFT_ENDPOINT_REMOVED: 0,
    RIGHT_ENDPOINT_REMOVED: 1,
    EMPTY: 2,
    REMOVED: 3,
    MULTI_BLOCK: 4,
    DUPLICATE: 5,
    OVERLAP: 6,
    NESTED: 7,
    INVALID_BLOCK: 8,
  };
  uniqueReasons.sort((left, right) => (positionById.get(left.annotationId) ?? Number.MAX_SAFE_INTEGER)
    - (positionById.get(right.annotationId) ?? Number.MAX_SAFE_INTEGER)
    || left.annotationId.localeCompare(right.annotationId)
    || codePriority[left.code] - codePriority[right.code]);
  const affectedAnnotationIds = [...new Set(uniqueReasons.map((reason) => reason.annotationId))];
  return { kind: "ANNOTATION_IMPACT", affectedAnnotationIds, destructive: true, reasons: uniqueReasons };
}
