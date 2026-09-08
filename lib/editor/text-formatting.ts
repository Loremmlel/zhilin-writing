import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { SerializerReady, serializerCtx } from "@milkdown/kit/core";
import { paragraphSchema, headingSchema } from "@milkdown/kit/preset/commonmark";
import { tableCellSchema, tableHeaderSchema } from "@milkdown/kit/preset/gfm";
import { $markSchema, $remark } from "@milkdown/kit/utils";
import type { DOMOutputSpec } from "@milkdown/kit/prose/model";
import { parseAnnotationMarkdown, stringifyAnnotationMarkdown } from "../annotations/markdown.ts";
import {
  canonicalizeEditorAnnotations,
  centered,
  fontSize,
  readTextStyle,
  remarkFormatting,
  textColor,
  textStyleAttributes,
  textStyleCss,
  type FormatNode,
  type TextStyle,
} from "../markdown/formatting.ts";

export function domTextStyle(element: HTMLElement): TextStyle {
  const raw = element.style.fontSize;
  const match = /^(\d+(?:\.\d+)?)(pt|px|rem)$/.exec(raw);
  const points = match
    ? Number(match[1]) * (match[2] === "px" ? 0.75 : match[2] === "rem" ? 12 : 1)
    : NaN;
  const nearest = Math.round(points * 2) / 2;
  const size = Math.abs(points - nearest) < 0.00001 ? fontSize(nearest) : undefined;
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(element.style.color);
  const color =
    textColor(element.style.color) ??
    (rgb && rgb.slice(1).every((n) => Number(n) <= 255)
      ? "#" +
        rgb
          .slice(1)
          .map((n) => Number(n).toString(16).padStart(2, "0"))
          .join("")
      : undefined);
  return { ...(size === undefined ? {} : { size }), ...(color ? { color } : {}) };
}
const parsingTextStyles = new WeakMap<object, TextStyle>();

export const textStyleSchema = $markSchema("textStyle", () => ({
  priority: 30,
  attrs: { size: { default: null }, color: { default: null } },
  spanning: true,
  parseDOM: [
    {
      tag: "span[style]",
      getAttrs: (element: HTMLElement) => {
        let style = domTextStyle(element);
        if (!Object.keys(style).length) return false;
        for (
          let parent = element.parentElement;
          parent && !parent.classList.contains("ProseMirror");
          parent = parent.parentElement
        ) {
          if (parent.tagName === "SPAN") style = { ...domTextStyle(parent), ...style };
        }
        return style;
      },
    },
  ],
  toDOM: (mark) => ["span", { class: "document-text-style", style: textStyleCss(mark.attrs) }, 0],
  parseMarkdown: {
    match: (node) => node.type === "textDirective" && node.name === "text",
    runner: (state, node, type) => {
      const previous = parsingTextStyles.get(state);
      const style = { ...previous, ...readTextStyle(node.attributes as Record<string, unknown>) };
      parsingTextStyles.set(state, style);
      state.openMark(type, style);
      try {
        state.next(node.children);
      } finally {
        state.closeMark(type);
        if (previous) {
          parsingTextStyles.set(state, previous);
          state.openMark(type, previous);
        } else parsingTextStyles.delete(state);
      }
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "textStyle",
    runner: (state, mark) => {
      state.withMark(mark, "textDirective", undefined, {
        name: "text",
        attributes: textStyleAttributes(mark.attrs),
      });
    },
  },
}));
const formatRemark = $remark("documentFormatting", () => remarkFormatting);
const formatSerializer: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SerializerReady);
  const original = ctx.get(serializerCtx);
  ctx.set(serializerCtx, (doc) => {
    const tree = parseAnnotationMarkdown(original(doc));
    canonicalizeEditorAnnotations(tree as FormatNode);
    return stringifyAnnotationMarkdown(tree);
  });
};
export const textFormattingPlugin = [textStyleSchema, formatRemark, formatSerializer].flat();

/** Extend the installed schemas through their context; keep Crepe's nodes and commands. */
export function configureTextFormatting(ctx: Ctx) {
  for (const entry of [paragraphSchema, headingSchema, tableCellSchema, tableHeaderSchema]) {
    ctx.update(entry.key, (previous) => (context) => {
      const base = previous(context);
      const cell = entry === tableCellSchema || entry === tableHeaderSchema;
      return {
        ...base,
        attrs: { ...base.attrs, textAlign: { default: null } },
        parseDOM: base.parseDOM?.map((rule) =>
          "tag" in rule
            ? {
                ...rule,
                getAttrs: (dom: HTMLElement) => {
                  const attrs = rule.getAttrs?.(dom) ?? rule.attrs ?? {};
                  if (attrs === false) return false;
                  return {
                    ...attrs,
                    textAlign:
                      dom.style.textAlign === "center" || dom.dataset.textAlign === "center"
                        ? "center"
                        : null,
                  };
                },
              }
            : rule,
        ),
        toDOM: (node) => {
          const spec = base.toDOM!(node) as [string, Record<string, unknown>, ...DOMOutputSpec[]];
          if (node.attrs.textAlign !== "center") return spec;
          const attrs = typeof spec[1] === "object" && !Array.isArray(spec[1]) ? spec[1] : {};
          return [
            spec[0],
            {
              ...attrs,
              "data-text-align": "center",
              style: `${attrs.style ?? ""};text-align:center`,
            },
            0,
          ] as DOMOutputSpec;
        },
        parseMarkdown: {
          ...base.parseMarkdown,
          runner: (state, node, type) => {
            if (cell) {
              state.openNode(type, {
                alignment: node.align,
                textAlign: centered(node) ? "center" : null,
              });
              state
                .openNode(state.schema.nodes.paragraph!)
                .next(node.children)
                .closeNode()
                .closeNode();
            } else {
              state.openNode(type, {
                ...(entry === headingSchema ? { level: node.depth } : {}),
                textAlign: centered(node) ? "center" : null,
              });
              if (node.children) state.next(node.children);
              else state.addText(String(node.value ?? ""));
              state.closeNode();
            }
          },
        },
        toMarkdown: {
          ...base.toMarkdown,
          runner: (state, node) => {
            if (node.attrs.textAlign !== "center") {
              base.toMarkdown.runner(state, node);
              return;
            }
            if (cell) {
              state.openNode("tableCell").openNode("textDirective", undefined, {
                name: "align",
                attributes: { value: "center" },
              });
              node.forEach((paragraph) => state.next(paragraph.content));
              state.closeNode().closeNode();
            } else if (node.type.name === "paragraph" && !node.content.size) {
              state.addNode("leafDirective", [], undefined, {
                name: "align",
                attributes: { value: "center" },
              });
            } else {
              state.openNode("containerDirective", undefined, {
                name: "align",
                attributes: { value: "center" },
              });
              base.toMarkdown.runner(state, node);
              state.closeNode();
            }
          },
        },
      };
    });
  }
}
