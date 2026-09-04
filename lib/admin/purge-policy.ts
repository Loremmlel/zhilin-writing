import {
  collectAnnotationIds,
  parseAnnotationMarkdown,
  stringifyAnnotationMarkdown,
} from "../annotations/markdown.ts";
import { unwrapAnnotation } from "../annotations/selection.ts";

export function normalizeAdminSelection(ids: string[]) {
  const normalized = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) throw new Error("请选择至少一条内容");
  if (normalized.length > 20) throw new Error("每次最多管理当前页的 20 条内容");
  return normalized;
}

export function replyIdsForPurge(
  target: { id: string; rootReplyId: string | null },
  rows: Array<{ id: string; rootReplyId: string | null }>,
) {
  return target.rootReplyId
    ? [target.id]
    : rows
        .filter((row) => row.id === target.id || row.rootReplyId === target.id)
        .map((row) => row.id);
}

export function removeAnnotationFromMarkdown(markdown: string, annotationId: string) {
  const tree = parseAnnotationMarkdown(markdown);
  if (!collectAnnotationIds(tree).includes(annotationId)) return markdown;
  return stringifyAnnotationMarkdown(unwrapAnnotation(tree, annotationId));
}
