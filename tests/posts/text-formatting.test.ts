import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { Editor, rootCtx, parserCtx, serializerCtx, editorViewCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { annotationPlugin } from "../../lib/editor/annotation-mark.ts";
import { configureTextFormatting, textFormattingPlugin } from "../../lib/editor/text-formatting.ts";
import {
  parseAnnotationMarkdown,
  stringifyAnnotationMarkdown,
} from "../../lib/annotations/markdown.ts";
import { validateCanonicalAnnotationDocument } from "../../lib/annotations/invariants.ts";
import { renderMarkdown, markdownToPlainText } from "../../lib/markdown/render.ts";
import { formattingIsValid } from "../../lib/markdown/formatting.ts";
const ID = "ann_550e8400-e29b-41d4-a716-446655440000";
async function withEditor(run: (editor: Editor) => Promise<void> | void) {
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
    requestAnimationFrame: (cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: number) =>
      window.clearTimeout(id as unknown as ReturnType<typeof window.setTimeout>),
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root as unknown as HTMLElement);
      configureTextFormatting(ctx);
    })
    .use(commonmark)
    .use(gfm)
    .use(annotationPlugin)
    .use(textFormattingPlugin)
    .use(createFormattingSelectionPlugin(() => {}))
    .create();
  try {
    await run(editor);
  } finally {
    await editor.destroy();
    window.close();
  }
}
test("formatting renders safe styles without exposing HTML or directive attributes", async () => {
  const source = ':::align{value="center"}\n\n## :text[你好]{size="18" color="#c00000"}\n\n:::';
  const html = await renderMarkdown(source);
  assert.match(html, /<h2 style="text-align:center">/);
  assert.match(html, /font-size:1.5rem;color:#c00000/);
  assert.equal(markdownToPlainText(source), "你好");
  assert.match(await renderMarkdown('<span style="color:red">文字</span>'), /<p>文字<\/p>/);
  for (const source of [
    ':text[正文]{color="red;position:fixed"}',
    ':text[正文]{size="999"}',
    ':text[正文]{color="#ff0000" onclick="alert(1)"}',
    ':::align{value="center"}\n\n---\n\n:::',
  ]) {
    assert.equal(formattingIsValid(parseAnnotationMarkdown(source)), false);
    assert.doesNotMatch(await renderMarkdown(source), /position:|onclick=|999rem/);
  }
});
test("formatting and continuous annotation identity survive two real Milkdown round trips", async () => {
  await withEditor((editor) => {
    const parse = editor.ctx.get(parserCtx),
      serialize = editor.ctx.get(serializerCtx);
    const fixtures = [
      `:text[之前 :annotation[红字]{#${ID}}]{color="#ff0000"}:annotation[:text[大字]{size="18"} 普通字]{#${ID}}`,
      `:::align{value="center"}\n\n## :annotation[:text[粗 **体**]{size="18"} 普通字]{#${ID}}\n\n:::`,
      `:::align{value="center"}\n\n:annotation[第一段]{#${ID}}\n\n:::\n\n> :annotation[:text[第二段]{color="#00aa00"}]{#${ID}}`,
      '| 列 |\n| --- |\n| :align[:text[单元格]{size="10.5" color="#c00000"}]{value="center"} |',
      '::align{value="center"}',
    ];
    for (const source of fixtures) {
      const first = parse(source);
      const once = serialize(first);
      const second = parse(once);
      const twice = serialize(second);
      assert.equal(twice, once);
      assert.equal(markdownToPlainText(twice), markdownToPlainText(source));
      if (source.includes(ID))
        assert.deepEqual(validateCanonicalAnnotationDocument(twice, [ID]).issues, [], twice);
      assert.deepEqual(second.toJSON(), parse(twice).toJSON());
      if (source.includes("center")) assert.match(twice, /center/);
      if (source.includes("size=")) assert.match(twice, /size=/);
      if (source.includes("color=")) assert.match(twice, /color=/);
    }
  });
});
test("normalized alignment is structurally transparent and retains source positions", () => {
  const source = `:::align{value="center"}\n\n:annotation[正文]{#${ID}}\n\n:::`;
  const tree = parseAnnotationMarkdown(source);
  assert.equal(tree.children[0]!.type, "paragraph");
  assert.equal(validateCanonicalAnnotationDocument(source, [ID]).ok, true);
  const node = (
    tree.children[0] as unknown as {
      children: Array<{ position: { start: { offset: number }; end: { offset: number } } }>;
    }
  ).children[0]!;
  assert.equal(
    source.slice(node.position.start.offset, node.position.end.offset),
    `:annotation[正文]{#${ID}}`,
  );
  assert.equal(markdownToPlainText(stringifyAnnotationMarkdown(tree)), "正文");
});

test("formatting commands preserve other attributes, annotations, selection boundaries and one-step undo", async () => {
  await withEditor((editor) => {
    const view = editor.ctx.get(editorViewCtx),
      parse = editor.ctx.get(parserCtx),
      serialize = editor.ctx.get(serializerCtx);
    const doc = parse(`:annotation[:text[甲乙]{size="18" color="#c00000"} 丙丁]{#${ID}}\n\n下一段`);
    view.updateState(EditorState.create({ schema: view.state.schema, doc, plugins: [history()] }));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    assert.equal(formattingStatus(view.state).size, "mixed");
    const before = serialize(view.state.doc);
    assert.equal(applyTextFormatting(view, "size", 24), true);
    assert.match(serialize(view.state.doc), /color="#c00000"/);
    assert.equal(validateCanonicalAnnotationDocument(serialize(view.state.doc), [ID]).ok, true);
    assert.equal(undo(view.state, view.dispatch), true);
    assert.equal(serialize(view.state.doc), before);
    applyTextFormatting(view, "size", 24);
    const sized = serialize(view.state.doc);
    applyTextFormatting(view, "color", "#386647");
    assert.equal(undo(view.state, view.dispatch), true);
    assert.equal(serialize(view.state.doc), sized);
    undo(view.state, view.dispatch);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)));
    assert.equal(applyTextFormatting(view, "center", true), true);
    assert.equal(view.state.doc.child(0).attrs.textAlign, "center");
    assert.equal(view.state.doc.child(1).attrs.textAlign, null);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    applyTextFormatting(view, "size", null);
    const mark = view.state.doc
      .child(0)
      .child(0)
      .marks.find((mark) => mark.type.name === "textStyle");
    assert.equal(mark?.attrs.size, null);
    assert.equal(mark?.attrs.color, "#c00000");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const unchanged = view.state.doc;
    applyTextFormatting(view, "size", 36);
    assert.equal(view.state.doc, unchanged);
    assert.equal(
      view.state.storedMarks?.find((mark) => mark.type.name === "textStyle")?.attrs.size,
      36,
    );
  });
});

import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { history, undo } from "@milkdown/kit/prose/history";
import {
  applyTextFormatting,
  formattingStatus,
  createFormattingSelectionPlugin,
  captureFormattingSelection,
  formattingSelectionKey,
} from "../../lib/editor/text-formatting-commands.ts";

test("toolbar bookmark maps edits and invalidates deleted content; paste strips only annotation marks", async () => {
  await withEditor((editor) => {
    const view = editor.ctx.get(editorViewCtx),
      parse = editor.ctx.get(parserCtx);
    view.dispatch(
      view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        parse(`:annotation[:text[甲乙丙]{size="18" color="#c00000"}]{#${ID}}`).content,
      ),
    );
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    captureFormattingSelection(view);
    view.dispatch(view.state.tr.insertText("前", 1));
    assert.equal(formattingSelectionKey.getState(view.state)?.from, 2);
    assert.equal(applyTextFormatting(view, "color", "#386647"), true);
    const slice = view.state.selection.content();
    let pasted = slice;
    view.someProp("transformPasted", (transform) => {
      pasted = transform(pasted, view, false);
    });
    pasted.content.descendants((node) => {
      assert.equal(
        node.marks.some((mark) => mark.type.name === "annotation"),
        false,
      );
      if (node.isText)
        assert.equal(node.marks.find((mark) => mark.type.name === "textStyle")?.attrs.size, 18);
    });
    captureFormattingSelection(view);
    view.dispatch(view.state.tr.delete(1, 5));
    assert.equal(formattingStatus(view.state).supported, false);
    assert.equal(applyTextFormatting(view, "size", 24), false);
  });
});

import { inspectAnnotationTransaction } from "../../lib/editor/annotation-guard.ts";
import { scanCanonicalAnnotationAnchorStates } from "../../lib/annotations/invariants.ts";

test("format changes inside annotations remain guard-safe and update conflict signatures", async () => {
  await withEditor((editor) => {
    const parse = editor.ctx.get(parserCtx),
      view = editor.ctx.get(editorViewCtx);
    const source = `:annotation[甲乙丙]{#${ID}}`;
    const doc = parse(source);
    const state = EditorState.create({ schema: view.state.schema, doc });
    assert.deepEqual(
      inspectAnnotationTransaction(
        doc,
        state.tr.addMark(1, 3, state.schema.marks.textStyle!.create({ size: 18 })),
      ),
      { kind: "SAFE" },
    );
    assert.deepEqual(
      inspectAnnotationTransaction(
        doc,
        state.tr.setNodeMarkup(0, undefined, { textAlign: "center" }),
      ),
      { kind: "SAFE" },
    );
    const original = scanCanonicalAnnotationAnchorStates(source);
    assert.notDeepEqual(
      scanCanonicalAnnotationAnchorStates(`:text[${source}]{size="18"}`),
      original,
    );
    assert.notDeepEqual(
      scanCanonicalAnnotationAnchorStates(`:::align{value="center"}\n\n${source}\n\n:::`),
      original,
    );
  });
});

test("formatting handles centered lists, empty blocks, individual cells and unsupported mixed selections", async () => {
  await withEditor((editor) => {
    const view = editor.ctx.get(editorViewCtx),
      parse = editor.ctx.get(parserCtx),
      serialize = editor.ctx.get(serializerCtx);
    for (const source of [
      '- :::align{value="center"}\n\n  列表文字\n\n  :::',
      '> :::align{value="center"}\n>\n> 引用文字\n>\n> :::',
    ]) {
      const doc = parse(source),
        once = serialize(doc);
      assert.match(once, /center/);
      assert.equal(serialize(parse(once)), once);
    }
    const table = parse("| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |");
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, table.content));
    let first = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "甲") first = pos;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first)));
    assert.equal(applyTextFormatting(view, "center", true), true);
    assert.equal(view.state.doc.firstChild?.firstChild?.firstChild?.attrs.textAlign, "center");
    assert.equal(view.state.doc.firstChild?.firstChild?.child(1).attrs.textAlign, null);
    const tableOnce = serialize(view.state.doc);
    assert.equal(serialize(parse(tableOnce)), tableOnce);
    view.dispatch(
      view.state.tr.replaceWith(0, view.state.doc.content.size, parse("普通 `代码` 文字").content),
    );
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1),
      ),
    );
    assert.equal(formattingStatus(view.state).supported, false);
    assert.equal(applyTextFormatting(view, "color", "#ff0000"), false);
  });
});

test("nested imported or pasted text styles retain inherited attributes around inner formatting", async () => {
  await withEditor((editor) => {
    const parse = editor.ctx.get(parserCtx),
      serialize = editor.ctx.get(serializerCtx);
    const doc = parse(':text[甲 :text[乙]{size="18"} 丙]{color="#c00000"}');
    const styles: unknown[] = [];
    doc.descendants((node) => {
      if (node.isText)
        styles.push([
          node.text,
          { ...node.marks.find((mark) => mark.type.name === "textStyle")?.attrs },
        ]);
    });
    assert.deepEqual(styles, [
      ["甲 ", { size: null, color: "#c00000" }],
      ["乙", { size: 18, color: "#c00000" }],
      [" 丙", { size: null, color: "#c00000" }],
    ]);
    assert.equal(serialize(parse(serialize(doc))), serialize(doc));
  });
});

import { DOMParser as ProseDOMParser, DOMSerializer } from "@milkdown/kit/prose/model";

test("clipboard HTML preserves rounded rem sizes, nested styles and paragraph alignment", async () => {
  await withEditor((editor) => {
    const parse = editor.ctx.get(parserCtx),
      schema = editor.ctx.get(editorViewCtx).state.schema;
    const doc = parse(':::align{value="center"}\n\n:text[复制]{size="14" color="#c00000"}\n\n:::');
    const root = document.createElement("div");
    root.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    assert.deepEqual(ProseDOMParser.fromSchema(schema).parse(root).toJSON(), doc.toJSON());
    root.innerHTML =
      '<p><span style="font-size:14pt;color:#c00000">甲<span style="font-size:18pt">乙</span>丙</span></p>';
    const pasted = ProseDOMParser.fromSchema(schema).parse(root);
    const styles: unknown[] = [];
    pasted.descendants((node) => {
      if (node.isText)
        styles.push([
          node.text,
          { ...node.marks.find((mark) => mark.type.name === "textStyle")?.attrs },
        ]);
    });
    assert.deepEqual(styles, [
      ["甲", { size: 14, color: "#c00000" }],
      ["乙", { size: 18, color: "#c00000" }],
      ["丙", { size: 14, color: "#c00000" }],
    ]);
  });
});

import { CellSelection } from "@milkdown/kit/prose/tables";

test("rectangular cell selections format only selected cells and keep mapped collapsed cursors collapsed", async () => {
  await withEditor((editor) => {
    const view = editor.ctx.get(editorViewCtx),
      parse = editor.ctx.get(parserCtx);
    view.dispatch(
      view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        parse("| 甲 | 乙 | 丙 |\n| --- | --- | --- |\n| 丁 | 戊 | 己 |").content,
      ),
    );
    const cells: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (["table_cell", "table_header"].includes(node.type.name)) cells.push(pos);
    });
    view.dispatch(
      view.state.tr.setSelection(CellSelection.create(view.state.doc, cells[0]!, cells[3]!)),
    );
    captureFormattingSelection(view);
    assert.equal(applyTextFormatting(view, "size", 24), true);
    view.state.doc.descendants((node) => {
      if (node.isText)
        assert.equal(
          node.marks.find((mark) => mark.type.name === "textStyle")?.attrs.size,
          ["甲", "丁"].includes(node.text!) ? 24 : undefined,
        );
    });
    assert.equal(applyTextFormatting(view, "center", true), true);
    for (const [index, pos] of cells.entries())
      assert.equal(
        view.state.doc.nodeAt(pos)!.attrs.textAlign,
        [0, 3].includes(index) ? "center" : null,
      );
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, parse("正文").content));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    captureFormattingSelection(view);
    view.dispatch(view.state.tr.insertText("前", 1));
    applyTextFormatting(view, "size", 18);
    assert.equal(view.state.selection.empty, true);
    assert.equal(view.state.doc.firstChild?.firstChild?.marks.length, 0);
  });
});
