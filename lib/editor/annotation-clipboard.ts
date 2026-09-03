import {
  Fragment,
  type Mark,
  type MarkType,
  type Node as ProseMirrorNode,
  Slice,
} from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";

import { analyzeAnnotationRanges } from "./annotation-ranges.ts";

function mapNode(
  node: ProseMirrorNode,
  transformMarks: (marks: readonly Mark[]) => readonly Mark[],
): ProseMirrorNode {
  if (node.isText) return node.mark(transformMarks(node.marks));
  if (node.isLeaf) return node;
  const children: ProseMirrorNode[] = [];
  node.content.forEach((child) => children.push(mapNode(child, transformMarks)));
  return node.copy(Fragment.fromArray(children));
}

function mapSlice(
  slice: Slice,
  transformMarks: (marks: readonly Mark[]) => readonly Mark[],
): Slice {
  const children: ProseMirrorNode[] = [];
  slice.content.forEach((child) => children.push(mapNode(child, transformMarks)));
  return new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd);
}

export function stripAnnotationMarksFromSlice(slice: Slice, annotationMarkType: MarkType): Slice {
  return mapSlice(slice, (marks) => marks.filter((mark) => mark.type !== annotationMarkType));
}

export function inheritDestinationAnnotationMark(
  slice: Slice,
  state: EditorState,
  annotationMarkType: MarkType,
): Slice {
  if (!state.selection.empty) return slice;
  const position = state.selection.from;
  const range = analyzeAnnotationRanges(state.doc).ranges.find(
    (candidate) => candidate.from < position && position < candidate.to,
  );
  if (!range) return slice;

  const mark = state.doc
    .resolve(position)
    .marks()
    .find(
      (candidate) =>
        candidate.type === annotationMarkType &&
        candidate.attrs.annotationId === range.annotationId,
    );
  if (!mark) return slice;
  return mapSlice(slice, (marks) =>
    marks.some((candidate) => candidate.type === annotationMarkType) ? marks : [...marks, mark],
  );
}
