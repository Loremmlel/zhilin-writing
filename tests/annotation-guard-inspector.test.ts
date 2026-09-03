import assert from "node:assert/strict";
import test, { after } from "node:test";

import { Editor, parserCtx, rootCtx, schemaCtx } from "@milkdown/kit/core";
import { joinBackward, setBlockType, splitBlock, toggleMark } from "@milkdown/kit/prose/commands";
import type { Mark, Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { liftListItem, sinkListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import { EditorState, TextSelection, type Command, type Transaction } from "@milkdown/kit/prose/state";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Window } from "happy-dom";

import { inspectAnnotationTransaction } from "../lib/editor/annotation-guard.ts";
import { scanAnnotationRanges } from "../lib/editor/annotation-ranges.ts";
import { annotationPlugin } from "../lib/editor/annotation-mark.ts";

const CURSOR = "⌁";
const SELECTION_FROM = "⟦";
const SELECTION_TO = "⟧";

const window = new Window({ url: "https://example.test" });
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  MutationObserver: window.MutationObserver,
  DOMParser: window.DOMParser,
  getSelection: window.getSelection.bind(window),
  addEventListener: window.addEventListener.bind(window),
  removeEventListener: window.removeEventListener.bind(window),
  dispatchEvent: window.dispatchEvent.bind(window),
  requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (id: number) => window.clearTimeout(id as unknown as ReturnType<typeof window.setTimeout>),
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });

const root = window.document.createElement("div");
window.document.body.append(root);
const editor = await Editor.make()
  .config((ctx) => ctx.set(rootCtx, root as unknown as Node))
  .use(commonmark)
  .use(gfm)
  .use(annotationPlugin)
  .create();
const parse = editor.ctx.get(parserCtx);
const schema = editor.ctx.get(schemaCtx);

after(async () => {
  await editor.destroy();
  window.close();
});

type Marker = { kind: "cursor" | "from" | "to"; pos: number };

function stateFrom(source: string): EditorState {
  const doc = parse(source);
  const markers: Marker[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const [token, kind] of [
      [CURSOR, "cursor"],
      [SELECTION_FROM, "from"],
      [SELECTION_TO, "to"],
    ] as const) {
      let offset = node.text.indexOf(token);
      while (offset >= 0) {
        markers.push({ kind, pos: pos + offset });
        offset = node.text.indexOf(token, offset + token.length);
      }
    }
  });
  markers.sort((left, right) => left.pos - right.pos);
  if (markers.length === 0) return EditorState.create({ doc });
  const cursors = markers.filter((marker) => marker.kind === "cursor");
  const from = markers.find((marker) => marker.kind === "from");
  const to = markers.find((marker) => marker.kind === "to");
  assert.equal(cursors.length + Number(Boolean(from || to)), 1, "use one cursor or one selection marker pair");
  assert.equal(Boolean(from), Boolean(to), "selection markers must be paired");

  let cleanup = EditorState.create({ doc }).tr;
  for (const marker of [...markers].sort((left, right) => right.pos - left.pos)) {
    cleanup = cleanup.delete(marker.pos, marker.pos + 1);
  }
  const cleanPosition = (marker: Marker) => marker.pos - markers.filter((candidate) => candidate.pos < marker.pos).length;
  const selection = cursors[0]
    ? TextSelection.create(cleanup.doc, cleanPosition(cursors[0]))
    : TextSelection.create(cleanup.doc, cleanPosition(from!), cleanPosition(to!));
  return EditorState.create({ doc: cleanup.doc, selection });
}

function commandTransaction(state: EditorState, command: Command): Transaction {
  let transaction: Transaction | undefined;
  assert.equal(command(state, (next) => { transaction = next; }), true);
  assert.ok(transaction);
  return transaction;
}

function annotationMark(annotationId: string): Mark {
  return schema.marks.annotation.create({ annotationId });
}

function markedDocument(
  segments: Array<{ text: string; annotationIds?: string[]; marks?: Mark[] }>,
  blockType = "paragraph",
): ProseMirrorNode {
  const content = segments.map((segment) => schema.text(
    segment.text,
    segment.marks ?? segment.annotationIds?.map(annotationMark) ?? [],
  ));
  return schema.node("doc", null, [schema.node(blockType, null, content)]);
}

function replacementTransaction(state: EditorState, nextDoc: ProseMirrorNode): Transaction {
  return state.tr.replaceWith(0, state.doc.content.size, nextDoc.content);
}

function impact(annotationIds: string[], reasons: Array<{ annotationId: string; code: string }>) {
  return {
    kind: "ANNOTATION_IMPACT",
    affectedAnnotationIds: annotationIds,
    destructive: true,
    reasons,
  };
}

test("scans formatted anchors and protects whole Unicode graphemes", () => {
  const state = stateFrom(":annotation[😀é **中文**]{#a}");
  const [range] = scanAnnotationRanges(state.doc);
  assert.equal(range.annotationId, "a");
  assert.equal(range.text, "😀é 中文");
  assert.equal(range.blockType, "paragraph");
  assert.equal(range.firstEndpoint.text, "😀");
  assert.equal(range.firstEndpoint.to - range.firstEndpoint.from, 2);
  assert.equal(range.lastEndpoint.text, "文");
  assert.ok(range.blockFrom < range.from && range.to < range.blockTo);
  assert.equal(schema.marks.annotation.spec.inclusive, false);
});

test("allows selection-only transactions and internal insertion", () => {
  const selected = stateFrom(":annotation[我⟦喜欢⟧你]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(selected.doc, selected.tr.setSelection(TextSelection.create(selected.doc, selected.selection.from))), { kind: "SAFE" });

  const state = stateFrom(":annotation[我⌁喜欢你]{#a}");
  const transaction = state.tr.insertText("非常");
  assert.deepEqual(inspectAnnotationTransaction(state.doc, transaction), { kind: "SAFE" });
  assert.equal(scanAnnotationRanges(transaction.doc)[0]?.text, "我非常喜欢你");
});

test("keeps exact-boundary insertion outside non-inclusive adjacent anchors", () => {
  const state = stateFrom(`:annotation[AA]{#a}${CURSOR}:annotation[BB]{#b}`);
  const transaction = state.tr.insertText("外部");
  assert.deepEqual(inspectAnnotationTransaction(state.doc, transaction), { kind: "SAFE" });
  assert.deepEqual(scanAnnotationRanges(transaction.doc).map((range) => [range.annotationId, range.text]), [
    ["a", "AA"],
    ["b", "BB"],
  ]);
});

test("allows internal Backspace, selection deletion, and selection replacement", () => {
  const backspace = stateFrom(":annotation[我喜⌁欢你]{#a}");
  const backspaceTransaction = backspace.tr.delete(backspace.selection.from - 1, backspace.selection.from);
  assert.deepEqual(inspectAnnotationTransaction(backspace.doc, backspaceTransaction), { kind: "SAFE" });
  assert.equal(scanAnnotationRanges(backspaceTransaction.doc)[0]?.text, "我欢你");

  for (const transactionFor of [
    (state: EditorState) => state.tr.deleteSelection(),
    (state: EditorState) => state.tr.insertText("非常喜欢"),
  ]) {
    const state = stateFrom(":annotation[我⟦喜欢⟧你]{#a}");
    assert.deepEqual(inspectAnnotationTransaction(state.doc, transactionFor(state)), { kind: "SAFE" });
  }
});

test("detects both ways of destroying the protected left endpoint", () => {
  const outside = stateFrom(`${CURSOR}:annotation[我喜欢你]{#a}`);
  assert.deepEqual(
    inspectAnnotationTransaction(outside.doc, outside.tr.delete(outside.selection.from, outside.selection.from + 1)),
    impact(["a"], [{ annotationId: "a", code: "LEFT_ENDPOINT_REMOVED" }]),
  );

  const inside = stateFrom(":annotation[我⌁喜欢你]{#a}");
  assert.deepEqual(
    inspectAnnotationTransaction(inside.doc, inside.tr.delete(inside.selection.from - 1, inside.selection.from)),
    impact(["a"], [{ annotationId: "a", code: "LEFT_ENDPOINT_REMOVED" }]),
  );
});

test("detects both ways of destroying the protected right endpoint", () => {
  const outside = stateFrom(`:annotation[我喜欢你]{#a}${CURSOR}`);
  assert.deepEqual(
    inspectAnnotationTransaction(outside.doc, outside.tr.delete(outside.selection.from - 1, outside.selection.from)),
    impact(["a"], [{ annotationId: "a", code: "RIGHT_ENDPOINT_REMOVED" }]),
  );

  const inside = stateFrom(":annotation[我喜欢⌁你]{#a}");
  assert.deepEqual(
    inspectAnnotationTransaction(inside.doc, inside.tr.delete(inside.selection.from, inside.selection.from + 1)),
    impact(["a"], [{ annotationId: "a", code: "RIGHT_ENDPOINT_REMOVED" }]),
  );
});

test("detects direct replacement of either protected endpoint", () => {
  const left = stateFrom(":annotation[⟦我⟧喜欢你]{#a}");
  assert.deepEqual(
    inspectAnnotationTransaction(left.doc, left.tr.insertText("他")),
    impact(["a"], [{ annotationId: "a", code: "LEFT_ENDPOINT_REMOVED" }]),
  );

  const right = stateFrom(":annotation[我喜欢⟦你⟧]{#a}");
  assert.deepEqual(
    inspectAnnotationTransaction(right.doc, right.tr.insertText("他")),
    impact(["a"], [{ annotationId: "a", code: "RIGHT_ENDPOINT_REMOVED" }]),
  );
});

test("classifies deletion of a one-grapheme or whole anchor as removed", () => {
  const one = stateFrom(":annotation[⟦我⟧]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(one.doc, one.tr.deleteSelection()), impact(["a"], [{ annotationId: "a", code: "REMOVED" }]));

  const whole = stateFrom("⟦:annotation[整段文字]{#a}⟧");
  assert.deepEqual(inspectAnnotationTransaction(whole.doc, whole.tr.deleteSelection()), impact(["a"], [{ annotationId: "a", code: "REMOVED" }]));
});

test("aggregates two destroyed annotations into one impact", () => {
  const state = stateFrom("⟦:annotation[AAA]{#a} xxxx :annotation[BBB]{#b}⟧");
  assert.deepEqual(inspectAnnotationTransaction(state.doc, state.tr.insertText("replacement")), impact(["a", "b"], [
    { annotationId: "a", code: "REMOVED" },
    { annotationId: "b", code: "REMOVED" },
  ]));
});

test("allows a canonical cross-block split and join while protecting the logical outer endpoints", () => {
  const split = stateFrom(":annotation[我非常⌁喜欢你]{#a}");
  const splitTransaction = commandTransaction(split, splitBlock);
  assert.deepEqual(inspectAnnotationTransaction(split.doc, splitTransaction), { kind: "SAFE" });
  assert.equal(scanAnnotationRanges(splitTransaction.doc).length, 2);

  const paragraph = stateFrom("⟦:annotation[整段]{#a}⟧\n\n下一段");
  assert.deepEqual(inspectAnnotationTransaction(paragraph.doc, paragraph.tr.deleteSelection()), impact(["a"], [{ annotationId: "a", code: "REMOVED" }]));

  const join = stateFrom(`第一段\n\n${CURSOR}:annotation[第二段]{#a}`);
  assert.deepEqual(inspectAnnotationTransaction(join.doc, commandTransaction(join, joinBackward)), { kind: "SAFE" });
});

test("allows heading conversion, list wrapping, indent, and outdent when the anchor stays legal", () => {
  const paragraph = stateFrom(":annotation[段⌁落]{#a}");
  const heading = commandTransaction(paragraph, setBlockType(schema.nodes.heading, { level: 2 }));
  assert.deepEqual(inspectAnnotationTransaction(paragraph.doc, heading), { kind: "SAFE" });

  const list = stateFrom(":annotation[列⌁表]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(list.doc, commandTransaction(list, wrapInList(schema.nodes.bullet_list))), { kind: "SAFE" });

  const indent = stateFrom("- 第一项\n- :annotation[第⌁二项]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(indent.doc, commandTransaction(indent, sinkListItem(schema.nodes.list_item))), { kind: "SAFE" });

  const outdent = stateFrom("- 第一项\n  - :annotation[第⌁二项]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(outdent.doc, commandTransaction(outdent, liftListItem(schema.nodes.list_item))), { kind: "SAFE" });
});

test("allows ordinary formatting across annotation boundaries", () => {
  const fixtures: Array<[string, (state: EditorState) => Transaction]> = [
    ["strong", (state) => commandTransaction(state, toggleMark(schema.marks.strong))],
    ["emphasis", (state) => commandTransaction(state, toggleMark(schema.marks.emphasis))],
    ["strike", (state) => commandTransaction(state, toggleMark(schema.marks.strike_through))],
    ["link", (state) => commandTransaction(state, toggleMark(schema.marks.link, { href: "https://example.test", title: null }))],
  ];
  for (const [label, transactionFor] of fixtures) {
    const state = stateFrom("前⟦缀 :annotation[批注]{#a} 后⟧缀");
    assert.deepEqual(inspectAnnotationTransaction(state.doc, transactionFor(state)), { kind: "SAFE" }, label);
  }

  const linked = stateFrom("⟦[前缀 :annotation[批注]{#a} 后缀](https://example.test)⟧");
  assert.deepEqual(inspectAnnotationTransaction(linked.doc, linked.tr.removeMark(linked.selection.from, linked.selection.to, schema.marks.link)), { kind: "SAFE" });
});

test("classifies duplicate and malformed multi-block anchors", () => {
  const base = stateFrom("普⌁通正文");
  const duplicate = parse(":annotation[A]{#a} gap :annotation[B]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(base.doc, replacementTransaction(base, duplicate)), impact(["a"], [{ annotationId: "a", code: "DUPLICATE" }]));

  const multiBlock = parse(":annotation[A]{#a}\n\n:annotation[B]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(base.doc, replacementTransaction(base, multiBlock)), { kind: "SAFE" });

  const gapped = parse(":annotation[A]{#a}\n\ngap\n\n:annotation[B]{#a}");
  assert.deepEqual(inspectAnnotationTransaction(base.doc, replacementTransaction(base, gapped)), impact(["a"], [{ annotationId: "a", code: "MULTI_BLOCK" }]));
});

test("classifies nested, overlapping, empty, and invalid-block anchors", () => {
  const base = stateFrom("普⌁通正文");
  const nested = markedDocument([
    { text: "A", annotationIds: ["a"] },
    { text: "B", annotationIds: ["a", "b"] },
    { text: "C", annotationIds: ["a"] },
  ]);
  assert.deepEqual(inspectAnnotationTransaction(base.doc, replacementTransaction(base, nested)), impact(["a", "b"], [
    { annotationId: "a", code: "NESTED" },
    { annotationId: "b", code: "NESTED" },
  ]));

  const overlap = markedDocument([
    { text: "A", annotationIds: ["a"] },
    { text: "B", annotationIds: ["a", "b"] },
    { text: "C", annotationIds: ["b"] },
  ]);
  assert.deepEqual(inspectAnnotationTransaction(base.doc, replacementTransaction(base, overlap)), impact(["a", "b"], [
    { annotationId: "a", code: "OVERLAP" },
    { annotationId: "b", code: "OVERLAP" },
  ]));

  const empty = markedDocument([{ text: "   ", annotationIds: ["a"] }]);
  assert.deepEqual(inspectAnnotationTransaction(base.doc, replacementTransaction(base, empty)), impact(["a"], [{ annotationId: "a", code: "EMPTY" }]));

  const invalid = parse("| 内容 |\n| --- |\n| :annotation[table]{#a} |");
  assert.deepEqual(inspectAnnotationTransaction(base.doc, replacementTransaction(base, invalid)), impact(["a"], [{ annotationId: "a", code: "INVALID_BLOCK" }]));
});

test("rejects annotation ranges formatted as attachment links", () => {
  const base = stateFrom("普⌁通正文");
  const linkedAttachment = markedDocument([{
    text: "附件",
    marks: [
      annotationMark("a"),
      schema.marks.link.create({ href: "/api/assets/file-a", title: null }),
    ],
  }]);

  assert.deepEqual(
    inspectAnnotationTransaction(base.doc, replacementTransaction(base, linkedAttachment)),
    impact(["a"], [{ annotationId: "a", code: "INVALID_BLOCK" }]),
  );
});

test("rejects marked expansion from either external annotation boundary", () => {
  const state = stateFrom(":annotation[AA]{#a}");
  const [range] = scanAnnotationRanges(state.doc);
  const leftExpansion = state.tr.insert(range.from, schema.text("X", [annotationMark("a")]));
  const rightExpansion = state.tr.insert(range.to, schema.text("X", [annotationMark("a")]));

  assert.deepEqual(
    inspectAnnotationTransaction(state.doc, leftExpansion),
    impact(["a"], [{ annotationId: "a", code: "LEFT_ENDPOINT_REMOVED" }]),
  );
  assert.deepEqual(
    inspectAnnotationTransaction(state.doc, rightExpansion),
    impact(["a"], [{ annotationId: "a", code: "RIGHT_ENDPOINT_REMOVED" }]),
  );
});

test("inspects a 50,000-character document with 200 anchors without pairwise work", () => {
  const content: ProseMirrorNode[] = [];
  for (let index = 0; index < 200; index += 1) {
    content.push(schema.text("字".repeat(250), [annotationMark(`ann-${index}`)]));
  }
  const doc = schema.node("doc", null, [schema.node("paragraph", null, content)]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
  const transaction = state.tr.insertText("新");
  const startedAt = performance.now();
  assert.deepEqual(inspectAnnotationTransaction(state.doc, transaction), { kind: "SAFE" });
  assert.ok(performance.now() - startedAt < 1_000);
});
