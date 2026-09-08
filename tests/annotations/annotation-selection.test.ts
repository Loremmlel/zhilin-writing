import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAnnotationIds,
  parseAnnotationMarkdown,
  stringifyAnnotationMarkdown,
  visiblePostText,
} from "../../lib/annotations/markdown.ts";
import { validateCanonicalAnnotationDocument } from "../../lib/annotations/invariants.ts";
import {
  AnnotationSelectionError,
  unwrapAnnotation,
  validateAnnotationSelection,
  wrapAnnotationRange,
} from "../../lib/annotations/selection.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";
const B = "ann_123e4567-e89b-42d3-a456-426614174000";

function descriptor(blockOrdinal: number, from: number, to: number, selectedText: string) {
  return {
    blockOrdinal,
    endBlockOrdinal: blockOrdinal,
    blockTextFrom: from,
    blockTextTo: to,
    selectedText,
  };
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
  const first = wrapAnnotationRange(
    parseAnnotationMarkdown("AAAABBBB xxxx CCCC"),
    descriptor(0, 0, 4, "AAAA"),
    A,
  );
  const adjacent = wrapAnnotationRange(first, descriptor(0, 4, 8, "BBBB"), B);
  assert.deepEqual(collectAnnotationIds(adjacent), [A, B]);
  assert.throws(() => wrapAnnotationRange(first, descriptor(0, 1, 5, "AAAB"), B), /重叠/);
  assert.throws(() => wrapAnnotationRange(first, descriptor(0, 0, 8, "AAAABBBB"), B), /重叠/);
});

test("reports stale text before overlap and keeps rejection reasons distinct", () => {
  const annotated = wrapAnnotationRange(
    parseAnnotationMarkdown("AAAABBBB"),
    descriptor(0, 0, 4, "AAAA"),
    A,
  );
  assert.throws(
    () => validateAnnotationSelection(annotated, descriptor(0, 0, 2, "错文")),
    (error) => error instanceof AnnotationSelectionError && error.code === "TEXT_MISMATCH",
  );
  assert.throws(
    () => validateAnnotationSelection(annotated, descriptor(0, 0, 2, "AA")),
    (error) => error instanceof AnnotationSelectionError && error.code === "OVERLAP",
  );
  assert.throws(
    () =>
      validateAnnotationSelection(
        parseAnnotationMarkdown(":unknown[文字]"),
        descriptor(0, 0, 2, "错文"),
      ),
    (error) => error instanceof AnnotationSelectionError && error.code === "TEXT_MISMATCH",
  );
  assert.throws(
    () =>
      validateAnnotationSelection(
        parseAnnotationMarkdown(":unknown[文字]"),
        descriptor(0, 0, 2, "文字"),
      ),
    (error) => error instanceof AnnotationSelectionError && error.code === "UNSUPPORTED_DIRECTIVE",
  );
  assert.throws(
    () =>
      validateAnnotationSelection(
        parseAnnotationMarkdown(`:annotation[:annotation[文字]{#${B}}]{#${A}}`),
        descriptor(0, 0, 2, "文字"),
      ),
    (error) => error instanceof AnnotationSelectionError && error.code === "NESTED_ANNOTATION",
  );
});

test("ignores an unsupported directive outside the selected range", () => {
  const source = parseAnnotationMarkdown(":unknown[前文] 后文");
  const next = wrapAnnotationRange(source, descriptor(0, 3, 5, "后文"), A);
  const markdown = stringifyAnnotationMarkdown(next);
  assert.equal(visiblePostText(next), visiblePostText(source));
  assert.deepEqual(collectAnnotationIds(next), [A]);
  assert.equal(validateCanonicalAnnotationDocument(markdown, [A]).ok, true);
});

test("wraps one logical annotation across consecutive text blocks", () => {
  const tree = parseAnnotationMarkdown("第一段 **后半**\n\n> 第二段\n\n- 第三段 前半");
  const next = wrapAnnotationRange(
    tree,
    {
      blockOrdinal: 0,
      endBlockOrdinal: 2,
      blockTextFrom: 4,
      blockTextTo: 3,
      selectedText: "后半\n\n第二段\n\n第三段",
    },
    A,
  );
  const markdown = stringifyAnnotationMarkdown(next);

  assert.equal(visiblePostText(next), visiblePostText(tree));
  assert.deepEqual(collectAnnotationIds(next), [A]);
  assert.equal(markdown.match(new RegExp(A, "g"))?.length, 3);
  assert.match(markdown, /\*\*后半\*\*/);
  const unwrapped = unwrapAnnotation(next, A);
  assert.equal(visiblePostText(unwrapped), visiblePostText(tree));
  assert.deepEqual(collectAnnotationIds(unwrapped), []);
});

test("rejects blank, stale text, unsupported blocks, and cross-block barriers", () => {
  const paragraphs = parseAnnotationMarkdown("第一段\n\n第二段");
  assert.throws(
    () => validateAnnotationSelection(parseAnnotationMarkdown("a   b"), descriptor(0, 1, 4, "   ")),
    /非空白/,
  );
  assert.throws(
    () => validateAnnotationSelection(paragraphs, descriptor(0, 0, 1, "错")),
    /正文已经变化/,
  );
  assert.throws(
    () =>
      validateAnnotationSelection(parseAnnotationMarkdown("第一段\n\n```\ncode\n```\n\n第二段"), {
        blockOrdinal: 0,
        endBlockOrdinal: 1,
        blockTextFrom: 0,
        blockTextTo: 1,
        selectedText: "第一段\n\n第",
      }),
    /不能穿过/,
  );
  for (const markdown of [
    "`code`",
    "![图](https://example.com/a.png)",
    "[附件](/api/assets/x)",
    "| A |\n| - |\n| B |",
    "```\ncode\n```",
  ]) {
    assert.throws(
      () =>
        validateAnnotationSelection(
          parseAnnotationMarkdown(markdown),
          descriptor(
            0,
            0,
            1,
            markdown.includes("附件") ? "附" : markdown.includes("code") ? "c" : "A",
          ),
        ),
      /不支持|不在可批注/,
    );
  }
});

test("unwrap removes a logical anchor while preserving visible text", () => {
  const tree = wrapAnnotationRange(
    parseAnnotationMarkdown("我喜欢你"),
    descriptor(0, 1, 3, "喜欢"),
    A,
  );
  const next = unwrapAnnotation(tree, A);
  assert.deepEqual(collectAnnotationIds(next), []);
  assert.equal(visiblePostText(next), "我喜欢你");
  assert.throws(() => unwrapAnnotation(next, A), /不存在或不唯一/);
});

test("unwrap preserves block boundaries around other annotations", () => {
  const markdown = `:annotation[删除]{#${A}}\n\n:annotation[保留]{#${B}}\n\n\`code\``;
  const nextMarkdown = stringifyAnnotationMarkdown(
    unwrapAnnotation(parseAnnotationMarkdown(markdown), A),
  );

  assert.equal(validateCanonicalAnnotationDocument(nextMarkdown, [B]).ok, true);
  assert.match(nextMarkdown, /删除\n\n:annotation\[保留\]/);
  assert.match(nextMarkdown, /\n\n`code`/);
});

test("creates annotations across colored text and centered blocks without changing the block map", () => {
  const tree = parseAnnotationMarkdown(
    ':::align{value="center"}\n\n甲:text[乙😀]{size="18" color="#c00000"}\n\n:::\n\n丙丁',
  );
  const next = wrapAnnotationRange(
    tree,
    {
      blockOrdinal: 0,
      endBlockOrdinal: 1,
      blockTextFrom: 1,
      blockTextTo: 1,
      selectedText: "乙😀\n\n丙",
    },
    A,
  );
  const markdown = stringifyAnnotationMarkdown(next);
  assert.equal(visiblePostText(next), visiblePostText(tree));
  assert.match(markdown, /center/);
  assert.match(markdown, /size="18"/);
  assert.equal(validateCanonicalAnnotationDocument(markdown, [A]).ok, true);
});
