import assert from "node:assert/strict";
import test from "node:test";

import { collectAnnotationIds, parseAnnotationMarkdown, stringifyAnnotationMarkdown, visiblePostText } from "../lib/annotations/markdown.ts";
import { unwrapAnnotation, validateAnnotationSelection, wrapAnnotationRange } from "../lib/annotations/selection.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";
const B = "ann_123e4567-e89b-42d3-a456-426614174000";

function descriptor(blockOrdinal: number, from: number, to: number, selectedText: string) {
  return { blockOrdinal, endBlockOrdinal: blockOrdinal, blockTextFrom: from, blockTextTo: to, selectedText };
}

test("wraps a same-block range without changing visible text or formatting", () => {
  const tree = parseAnnotationMarkdown("我 **非常喜欢** [你](https://example.com)");
  const next = wrapAnnotationRange(tree, descriptor(0, 2, 8, "非常喜欢 你"), A);
  const markdown = stringifyAnnotationMarkdown(next);
  assert.equal(visiblePostText(next), visiblePostText(tree));
  assert.deepEqual(collectAnnotationIds(next), [A]);
  assert.match(markdown, /\*\*非常喜欢\*\*/);
  assert.match(markdown, /https:\/\/example\.com/);
});

test("allows adjacent and separated annotations but rejects every overlap", () => {
  const first = wrapAnnotationRange(parseAnnotationMarkdown("AAAABBBB xxxx CCCC"), descriptor(0, 0, 4, "AAAA"), A);
  const adjacent = wrapAnnotationRange(first, descriptor(0, 4, 8, "BBBB"), B);
  assert.deepEqual(collectAnnotationIds(adjacent), [A, B]);
  assert.throws(() => wrapAnnotationRange(first, descriptor(0, 1, 5, "AAAB"), B), /重叠/);
  assert.throws(() => wrapAnnotationRange(first, descriptor(0, 0, 8, "AAAABBBB"), B), /重叠/);
});

test("rejects cross-block, blank, stale text, code, images, attachments, and tables", () => {
  const paragraphs = parseAnnotationMarkdown("第一段\n\n第二段");
  assert.throws(() => validateAnnotationSelection(paragraphs, { ...descriptor(0, 0, 1, "第"), endBlockOrdinal: 1 }), /同一个文本块/);
  assert.throws(() => validateAnnotationSelection(parseAnnotationMarkdown("a   b"), descriptor(0, 1, 4, "   ")), /非空白/);
  assert.throws(() => validateAnnotationSelection(paragraphs, descriptor(0, 0, 1, "错")), /正文已经变化/);
  for (const markdown of ["`code`", "![图](https://example.com/a.png)", "[附件](/api/assets/x)", "| A |\n| - |\n| B |", "```\ncode\n```"]) {
    assert.throws(() => validateAnnotationSelection(parseAnnotationMarkdown(markdown), descriptor(0, 0, 1, markdown.includes("附件") ? "附" : markdown.includes("code") ? "c" : "A")), /不支持|不在可批注/);
  }
});

test("unwrap removes exactly one anchor while preserving visible text", () => {
  const tree = wrapAnnotationRange(parseAnnotationMarkdown("我喜欢你"), descriptor(0, 1, 3, "喜欢"), A);
  const next = unwrapAnnotation(tree, A);
  assert.deepEqual(collectAnnotationIds(next), []);
  assert.equal(visiblePostText(next), "我喜欢你");
  assert.throws(() => unwrapAnnotation(next, A), /不存在或不唯一/);
});
