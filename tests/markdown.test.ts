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
