import assert from "node:assert/strict";
import test from "node:test";

import { markdownToPlainText, renderMarkdown } from "../lib/markdown/render.ts";

test("renders GFM task lists and tables", async () => {
  const html = await renderMarkdown(
    "- [x] 写完随笔\n\n| 名称 | 状态 |\n| --- | --- |\n| 初稿 | 完成 |",
  );
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<table>/);
  assert.match(html, /<td>完成<\/td>/);
});

test("removes executable and embedded HTML", async () => {
  const html = await renderMarkdown(
    "安全文字<script>alert(1)</script><iframe src=\"https://example.com\"></iframe>",
  );
  assert.doesNotMatch(html, /script|iframe|alert\(1\)/i);
  assert.match(html, /安全文字/);
});

test("produces searchable plain text without Markdown syntax", () => {
  const text = markdownToPlainText("# 雨天随笔\n\n这是 **安静** 的一天。[旧书店](https://example.com)");
  assert.equal(text, "雨天随笔 这是 安静 的一天。旧书店");
});

test("renders annotation directives as safe semantic marks without exposing internal syntax", async () => {
  const id = "ann_550e8400-e29b-41d4-a716-446655440000";
  const html = await renderMarkdown(`这里有 :annotation[一段 **批注文字**和[链接](https://example.com)]{#${id}}。`);
  assert.match(html, /<mark class="annotation-range"/);
  assert.match(html, new RegExp(`data-annotation-id="${id}"`));
  assert.match(html, /<strong>批注文字<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com">链接<\/a>/);
  assert.doesNotMatch(html, /:annotation\[/);
  assert.equal(markdownToPlainText(`:annotation[文字]{#${id}}`), "文字");
});

test("readonly rendering exposes only annotation ids admitted by the current snapshot", async () => {
  const id = "ann_550e8400-e29b-41d4-a716-446655440000";
  const blocked = await renderMarkdown(`:annotation[可见文字]{#${id}}`, { annotationIds: [] });
  assert.doesNotMatch(blocked, /annotation-range|data-annotation-id/);
  assert.match(blocked, /可见文字/);
  const allowed = await renderMarkdown(`:annotation[可见文字]{#${id}}`, { annotationIds: [id] });
  assert.match(allowed, new RegExp(`data-annotation-id="${id}"`));
  const unknown = await renderMarkdown(":note[普通文字]{#note}");
  assert.doesNotMatch(unknown, /annotation-range|data-annotation-id/);
  assert.match(unknown, /普通文字/);
});
