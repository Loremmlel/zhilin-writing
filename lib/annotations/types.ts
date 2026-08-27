import type { Root } from "mdast";

export type AnnotationId = `ann_${string}`;
export type AnnotationMarkdownRoot = Root;

export type AnnotationSelectionDescriptor = {
  blockOrdinal: number;
  endBlockOrdinal: number;
  blockTextFrom: number;
  blockTextTo: number;
  selectedText: string;
};
