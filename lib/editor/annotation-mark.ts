import remarkDirective from "remark-directive";

import { $markSchema, $remark } from "@milkdown/kit/utils";

export const annotationRemarkPlugin = $remark("annotationDirective", () => remarkDirective);

export const annotationSchema = $markSchema("annotation", () => ({
  priority: 20,
  attrs: { annotationId: { validate: "string" } },
  inclusive: false,
  spanning: true,
  parseDOM: [
    {
      tag: "mark[data-annotation-id]",
      getAttrs: (node: HTMLElement) => ({ annotationId: node.dataset.annotationId }),
    },
  ],
  toDOM: (mark) => [
    "mark",
    {
      class: "annotation-range",
      "data-annotation-id": mark.attrs.annotationId,
      tabindex: "0",
      "aria-label": "带批注的文字，按回车查看批注",
    },
  ],
  parseMarkdown: {
    match: (node) => node.type === "textDirective" && node.name === "annotation",
    runner: (state, node, markType) => {
      const attributes = node.attributes as Record<string, unknown> | undefined;
      const id = attributes?.id;
      if (typeof id !== "string") return;
      state.openMark(markType, { annotationId: id });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "annotation",
    runner: (state, mark) => {
      state.withMark(mark, "textDirective", undefined, {
        name: "annotation",
        attributes: { id: mark.attrs.annotationId },
      });
    },
  },
}));

export const annotationPlugin = [annotationRemarkPlugin, annotationSchema].flat();
