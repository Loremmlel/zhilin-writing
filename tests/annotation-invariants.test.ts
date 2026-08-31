import assert from "node:assert/strict";
import test from "node:test";

import {
  scanCanonicalAnnotationAnchors,
  validateCanonicalAnnotationDocument,
} from "../lib/annotations/invariants.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";
const B = "ann_123e4567-e89b-42d3-a456-426614174000";

function issueCodes(markdown: string, knownIds: Iterable<string>) {
  return validateCanonicalAnnotationDocument(markdown, knownIds).issues.map((issue) => issue.code);
}

test("accepts one continuous active anchor and preserves its formatted visible text", () => {
  const result = validateCanonicalAnnotationDocument(
    `正文 :annotation[我 **非常喜欢** 你]{#${A}}`,
    new Set([A]),
  );

  assert.deepEqual(result, {
    ok: true,
    anchors: [{ annotationId: A, text: "我 非常喜欢 你", blockIndex: 0 }],
    issues: [],
  });
});

test("accepts adjacent anchors and supported heading list and quote text blocks", () => {
  const markdown = [
    `# :annotation[标题]{#${A}}`,
    "",
    `- :annotation[列表]{#${B}}`,
  ].join("\n");

  assert.deepEqual(scanCanonicalAnnotationAnchors(markdown), [
    { annotationId: A, text: "标题", blockIndex: 0 },
    { annotationId: B, text: "列表", blockIndex: 1 },
  ]);
  assert.equal(validateCanonicalAnnotationDocument(markdown, [A, B]).ok, true);

  const adjacent = `:annotation[AAAA]{#${A}}:annotation[BBBB]{#${B}}`;
  assert.equal(validateCanonicalAnnotationDocument(adjacent, [A, B]).ok, true);
});

test("rejects duplicate anchors for one annotation ID", () => {
  const markdown = `:annotation[A]{#${A}} 和 :annotation[B]{#${A}}`;
  assert.deepEqual(issueCodes(markdown, [A]), ["DUPLICATE"]);
});

test("rejects empty and whitespace-only anchors", () => {
  assert.deepEqual(issueCodes(`:annotation[]{#${A}}`, [A]), ["EMPTY"]);
  assert.deepEqual(issueCodes(`:annotation[   ]{#${A}}`, [A]), ["EMPTY"]);
});

test("rejects container directives that span multiple text blocks", () => {
  const markdown = `:::annotation{#${A}}\n第一段\n\n第二段\n:::`;
  assert.deepEqual(issueCodes(markdown, [A]), ["MULTI_BLOCK"]);
});

test("rejects nested annotations without treating them as independent legal anchors", () => {
  const markdown = `:annotation[A :annotation[B]{#${B}} C]{#${A}}`;
  assert.deepEqual(issueCodes(markdown, [A, B]), ["NESTED"]);
});

test("rejects annotations in unsupported blocks or around non-text inline content", () => {
  const table = `| A |\n| - |\n| :annotation[B]{#${A}} |`;
  assert.deepEqual(issueCodes(table, [A]), ["INVALID_BLOCK"]);
  assert.deepEqual(issueCodes(`:annotation[\`code\`]{#${A}}`, [A]), ["INVALID_BLOCK"]);
  assert.deepEqual(issueCodes(`:annotation[![图](/api/assets/a)]{#${A}}`, [A]), ["INVALID_BLOCK"]);
});

test("rejects Markdown IDs absent from annotation data and active IDs absent from Markdown", () => {
  assert.deepEqual(issueCodes(`:annotation[A]{#${A}}`, [B]), ["UNKNOWN_ID", "MISSING_ACTIVE_ID"]);
  assert.deepEqual(issueCodes("没有批注", [A]), ["MISSING_ACTIVE_ID"]);
});

test("reports malformed annotation directives instead of silently ignoring them", () => {
  assert.deepEqual(issueCodes(":annotation[正文]", []), ["UNKNOWN_ID"]);
});
