import { CellSelection } from "@milkdown/kit/prose/tables";
import { closeHistory } from "@milkdown/kit/prose/history";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Selection,
  type SelectionBookmark,
} from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { fontSize, textColor } from "../markdown/formatting.ts";

type SavedSelection = {
  bookmark: SelectionBookmark;
  from: number;
  to: number;
  invalid?: boolean;
} | null;
export const formattingSelectionKey = new PluginKey<SavedSelection>("formattingSelection");
export function formattingSelection(state: EditorState): Selection {
  const saved = formattingSelectionKey.getState(state);
  if (!saved || saved.invalid) return state.selection;
  const resolved = saved.bookmark.resolve(state.doc);
  if (resolved instanceof CellSelection) return resolved;
  const backwards = resolved.anchor > resolved.head;
  return TextSelection.create(
    state.doc,
    backwards ? saved.to : saved.from,
    backwards ? saved.from : saved.to,
  );
}
export function captureFormattingSelection(view: EditorView) {
  if (!formattingSelectionKey.getState(view.state))
    view.dispatch(view.state.tr.setMeta(formattingSelectionKey, "capture"));
}
export function releaseFormattingSelection(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(formattingSelectionKey, "release"));
}
export function createFormattingSelectionPlugin(onUpdate: () => void) {
  return $prose(
    () =>
      new Plugin<SavedSelection>({
        key: formattingSelectionKey,
        state: {
          init: () => null,
          apply(tr, saved) {
            const action = tr.getMeta(formattingSelectionKey);
            if (action === "release") return null;
            if (action === "capture")
              return {
                bookmark: tr.selection.getBookmark(),
                from: tr.selection.from,
                to: tr.selection.to,
                invalid: !(
                  tr.selection instanceof TextSelection || tr.selection instanceof CellSelection
                ),
              };
            if (!saved || saved.invalid || !tr.docChanged) return saved;
            const from = tr.mapping.mapResult(saved.from, 1),
              to = tr.mapping.mapResult(saved.to, -1);
            if (
              from.deletedAcross ||
              to.deletedAcross ||
              (!tr.doc.eq(tr.before) && saved.from !== saved.to && from.pos >= to.pos)
            )
              return { ...saved, invalid: true };
            return {
              bookmark: saved.bookmark.map(tr.mapping),
              from: from.pos,
              to: saved.from === saved.to ? from.pos : to.pos,
            };
          },
        },
        props: {
          decorations(state) {
            const saved = formattingSelectionKey.getState(state);
            if (!saved || saved.invalid || saved.from >= saved.to) return null;
            return DecorationSet.create(state.doc, [
              ...formattingSelection(state).ranges.map(({ $from, $to }) =>
                Decoration.inline($from.pos, $to.pos, { class: "formatting-saved-selection" }),
              ),
            ]);
          },
        },
        view: () => ({ update: onUpdate }),
      }),
  );
}
function selectedContent(state: EditorState) {
  const selection = formattingSelection(state);
  let supported =
    (selection instanceof TextSelection || selection instanceof CellSelection) &&
    !formattingSelectionKey.getState(state)?.invalid;
  const blocks = new Map<number, ProseNode>();
  const marks: Array<{ size?: number; color?: string }> = [];
  const collectBlock = (pos: number) => {
    const resolved = state.doc.resolve(pos);
    if (!["paragraph", "heading"].includes(resolved.parent.type.name)) {
      supported = false;
      return;
    }
    let depth = resolved.depth;
    for (let d = depth; d > 0; d--)
      if (["table_cell", "table_header"].includes(resolved.node(d).type.name)) {
        depth = d;
        break;
      }
    blocks.set(resolved.before(depth), resolved.node(depth));
  };
  if (selection.empty) {
    collectBlock(selection.from);
    const active = state.storedMarks ?? selection.$from.marks();
    if (active.some((mark) => ["inlineCode", "code"].includes(mark.type.name))) supported = false;
    marks.push(active.find((mark) => mark.type.name === "textStyle")?.attrs ?? {});
  } else
    for (const { $from, $to } of selection.ranges)
      state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (node.isText) {
          collectBlock(Math.max($from.pos, pos));
          if (node.marks.some((mark) => ["inlineCode", "code"].includes(mark.type.name)))
            supported = false;
          marks.push(node.marks.find((mark) => mark.type.name === "textStyle")?.attrs ?? {});
        } else if (node.isTextblock && node.content.size === 0 && pos + 1 < $to.pos)
          collectBlock(pos + 1);
        else if (node.isLeaf || node.type.name === "code_block") supported = false;
      });
  return { selection, supported: supported && blocks.size > 0, blocks, marks };
}
export function formattingStatus(state: EditorState) {
  const { supported, blocks, marks } = selectedContent(state);
  const uniform = (key: "size" | "color") => {
    const values = new Set(marks.map((mark) => mark[key] ?? "default"));
    return values.size > 1 ? "mixed" : String(values.values().next().value ?? "default");
  };
  const centered = [...blocks.values()].filter((node) => node.attrs.textAlign === "center").length;
  return {
    supported,
    size: uniform("size"),
    color: uniform("color"),
    center: centered === 0 ? false : centered === blocks.size ? true : ("mixed" as const),
  };
}
export function applyTextFormatting(
  view: EditorView,
  key: "size" | "color" | "center",
  value: number | string | boolean | null,
) {
  const { state } = view;
  const { selection, supported, blocks } = selectedContent(state);
  if (!view.editable || !supported) return false;
  if (key === "size" && value !== null && fontSize(value) === undefined) return false;
  if (key === "color" && value !== null && !textColor(value)) return false;
  const tr = state.tr.setSelection(selection).setMeta(formattingSelectionKey, "release");
  if (key === "center") {
    for (const [pos, node] of blocks)
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: value ? "center" : null });
    if (selection.empty) tr.setStoredMarks(state.storedMarks);
  } else {
    const type = state.schema.marks.textStyle!;
    const updated = (attrs: Record<string, unknown>) => ({ ...attrs, [key]: value });
    if (selection.empty) {
      const marks = state.storedMarks ?? selection.$from.marks();
      const attrs = updated(marks.find((mark) => mark.type === type)?.attrs ?? {});
      tr.setStoredMarks(marks.filter((mark) => mark.type !== type));
      if (attrs.size != null || attrs.color != null) tr.addStoredMark(type.create(attrs));
    } else
      for (const { $from, $to } of selection.ranges)
        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          if (!node.isText) return;
          const attrs = updated(node.marks.find((mark) => mark.type === type)?.attrs ?? {});
          const from = Math.max(pos, $from.pos),
            to = Math.min(pos + node.nodeSize, $to.pos);
          tr.removeMark(from, to, type);
          if (attrs.size != null || attrs.color != null) tr.addMark(from, to, type.create(attrs));
        });
  }
  view.dispatch(closeHistory(tr).scrollIntoView());
  view.focus();
  return true;
}
