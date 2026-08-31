import { Fragment, Schema, Slice, type Mark } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection, type Plugin } from "@milkdown/kit/prose/state";

export const annotationTestSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    annotation: { attrs: { annotationId: {} }, inclusive: false },
    strong: {},
    emphasis: {},
    strike_through: {},
    link: { attrs: { href: {}, title: { default: null } } },
  },
});

export function annotationMark(annotationId: string): Mark {
  return annotationTestSchema.marks.annotation.create({ annotationId });
}

export function editorDoc(segments: Array<{ text: string; marks?: Mark[] }>) {
  return annotationTestSchema.node("doc", null, [
    annotationTestSchema.node("paragraph", null, segments.map(({ text, marks }) => annotationTestSchema.text(text, marks))),
  ]);
}

export function editorState(
  segments: Array<{ text: string; marks?: Mark[] }>,
  selection?: { from: number; to?: number },
  plugins: Plugin[] = [],
) {
  const doc = editorDoc(segments);
  return EditorState.create({
    doc,
    selection: selection ? TextSelection.create(doc, selection.from, selection.to ?? selection.from) : undefined,
    plugins,
  });
}

export function inlineSlice(segments: Array<{ text: string; marks?: Mark[] }>) {
  return new Slice(Fragment.fromArray(segments.map(({ text, marks }) => annotationTestSchema.text(text, marks))), 0, 0);
}
