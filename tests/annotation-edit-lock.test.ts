import assert from "node:assert/strict";
import test from "node:test";

import { ANNOTATED_POST_EDIT_MESSAGE, assertOrdinaryPostMarkdown, canOpenPostEditor } from "../lib/annotations/policy.ts";

test("annotated posts are temporarily edit locked while ordinary posts remain editable", () => {
  assert.equal(canOpenPostEditor(0), true);
  assert.equal(canOpenPostEditor(1), false);
  assert.match(ANNOTATED_POST_EDIT_MESSAGE, /下一版本完成/);
});

test("ordinary post mutations cannot forge annotation directives", () => {
  assert.equal(assertOrdinaryPostMarkdown("普通 **正文**"), "普通 **正文**");
  assert.throws(() => assertOrdinaryPostMarkdown(":annotation[伪造]{#ann_550e8400-e29b-41d4-a716-446655440000}"), /不能直接写入/);
});
