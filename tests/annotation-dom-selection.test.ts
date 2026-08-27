import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { describeAnnotationDomRange } from "../lib/annotations/dom-selection.ts";
import { renderMarkdown } from "../lib/markdown/render.ts";

async function bodyFor(markdown: string) {
  const window = new Window();
  const body = window.document.createElement("div");
  body.className = "markdown-body";
  body.innerHTML = await renderMarkdown(markdown);
  window.document.body.append(body);
  return { window, body: body as unknown as Element };
}

function rangeAround(window: Window, startNode: unknown, start: number, endNode: unknown, end: number): Range {
  const range = window.document.createRange();
  range.setStart(startNode as never, start);
  range.setEnd(endNode as never, end);
  return range as unknown as Range;
}

test("readonly DOM selection maps formatted text to one AST text block", async () => {
  const { window, body } = await bodyFor("我 **非常喜欢** 你\n\n> 另一段");
  const text = body.querySelector("strong")?.firstChild;
  assert.ok(text);
  assert.deepEqual(describeAnnotationDomRange(body, rangeAround(window, text, 0, text, 4)), { blockOrdinal: 0, endBlockOrdinal: 0, blockTextFrom: 2, blockTextTo: 6, selectedText: "非常喜欢" });
});

test("readonly selection rejects cross-block, code, tables, blanks, and overlap", async () => {
  const id = "ann_550e8400-e29b-41d4-a716-446655440000";
  const { window, body } = await bodyFor(`第一段\n\n第二段\n\n\`code\`\n\n| A |\n| - |\n| B |\n\n:annotation[已有]{#${id}} 旁边`);
  const paragraphs = body.querySelectorAll("p");
  assert.throws(() => describeAnnotationDomRange(body, rangeAround(window, paragraphs[0]!.firstChild!, 0, paragraphs[1]!.firstChild!, 1)), /同一个文本块/);
  const code = body.querySelector("code")!.firstChild!;
  assert.throws(() => describeAnnotationDomRange(body, rangeAround(window, code, 0, code, 2)), /暂不支持/);
  const cell = body.querySelector("td")!.firstChild!;
  assert.throws(() => describeAnnotationDomRange(body, rangeAround(window, cell, 0, cell, 1)), /暂不支持/);
  const overlap = body.querySelector(".annotation-range")!.firstChild!;
  assert.throws(() => describeAnnotationDomRange(body, rangeAround(window, overlap, 0, overlap, 1)), /重叠/);
});
