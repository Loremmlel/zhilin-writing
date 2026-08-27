import assert from "node:assert/strict";
import test from "node:test";

import { Editor, parserCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Window } from "happy-dom";

import { collectAnnotationIds, parseAnnotationMarkdown, stringifyAnnotationMarkdown, visiblePostText } from "../lib/annotations/markdown.ts";
import { annotationPlugin } from "../lib/editor/annotation-mark.ts";

const FIRST_ID = "ann_550e8400-e29b-41d4-a716-446655440000";
const SECOND_ID = "ann_123e4567-e89b-42d3-a456-426614174000";

function installDom() {
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
  return window;
}

async function milkdownRoundTrip(markdown: string) {
  const window = installDom();
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, root as unknown as Node))
    .use(commonmark)
    .use(gfm)
    .use(annotationPlugin)
    .create();
  try {
    const parse = editor.ctx.get(parserCtx);
    const serialize = editor.ctx.get(serializerCtx);
    const document = parse(markdown);
    return { document, markdown: serialize(document) };
  } finally {
    await editor.destroy();
    window.close();
  }
}

test("annotation directive preserves visible text and IDs through AST parse/stringify", () => {
  const source = `我觉得 :annotation[高中毕业是一个**很奇怪**的节点]{#${FIRST_ID}}。`;
  const tree = parseAnnotationMarkdown(source);
  assert.equal(visiblePostText(tree), "我觉得 高中毕业是一个很奇怪的节点。");
  assert.deepEqual(collectAnnotationIds(tree), [FIRST_ID]);
  const reparsed = parseAnnotationMarkdown(stringifyAnnotationMarkdown(tree));
  assert.equal(visiblePostText(reparsed), "我觉得 高中毕业是一个很奇怪的节点。");
  assert.deepEqual(collectAnnotationIds(reparsed), [FIRST_ID]);
});

test("Milkdown annotation mark round-trips supported inline formatting", async () => {
  const fixtures = [
    { source: `:annotation[我喜欢你]{#${FIRST_ID}}`, mark: null },
    { source: `:annotation[我 **非常喜欢** 你]{#${FIRST_ID}}`, mark: "strong" },
    { source: `:annotation[我 *喜欢* 你]{#${FIRST_ID}}`, mark: "emphasis" },
    { source: `:annotation[我 ~~喜欢~~ 你]{#${FIRST_ID}}`, mark: "strike_through" },
    { source: `:annotation[[链接文字](https://example.com/a)]{#${FIRST_ID}}`, mark: "link" },
  ] as const;
  for (const fixture of fixtures) {
    const result = await milkdownRoundTrip(fixture.source);
    const documentJson = result.document.toJSON();
    const textNodes: Array<{ type: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: unknown[] }> = [];
    const walk = (node: { type: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: unknown[] }) => {
      if (node.type === "text") textNodes.push(node);
      node.content?.forEach((child) => walk(child as typeof node));
    };
    walk(documentJson);
    assert.ok(textNodes.some((node) => node.marks?.some((mark) => mark.type === "annotation" && mark.attrs?.annotationId === FIRST_ID)));
    if (fixture.mark) assert.ok(textNodes.some((node) => node.marks?.some((mark) => mark.type === fixture.mark)));
    const reparsed = parseAnnotationMarkdown(result.markdown);
    assert.deepEqual(collectAnnotationIds(reparsed), [FIRST_ID]);
    assert.equal(visiblePostText(reparsed), visiblePostText(parseAnnotationMarkdown(fixture.source)));
    if (fixture.mark === "link") assert.match(result.markdown, /https:\/\/example\.com\/a/);
  }
});

test("adjacent and separated annotation marks remain independent after Milkdown reload", async () => {
  for (const source of [
    `:annotation[AAAA]{#${FIRST_ID}}:annotation[BBBB]{#${SECOND_ID}}`,
    `:annotation[AAAA]{#${FIRST_ID}} xxxx :annotation[BBBB]{#${SECOND_ID}}`,
  ]) {
    const first = await milkdownRoundTrip(source);
    const second = await milkdownRoundTrip(first.markdown);
    assert.deepEqual(collectAnnotationIds(parseAnnotationMarkdown(second.markdown)), [FIRST_ID, SECOND_ID]);
    assert.equal(visiblePostText(parseAnnotationMarkdown(second.markdown)), visiblePostText(parseAnnotationMarkdown(source)));
  }
});
