import assert from "node:assert/strict";
import test from "node:test";

import { assertAnnotationBelongsToPost, assertAnchorInvariant, createAnnotationId, resolveAnnotationReplyRecipient, validateAnnotationContent, validateAnnotationId, validateAnnotationSubmissionKey } from "../lib/annotations/policy.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";

test("annotation IDs are opaque UUIDs and submission keys are bounded UUIDs", () => {
  assert.match(createAnnotationId(), /^ann_[0-9a-f-]{36}$/);
  assert.equal(validateAnnotationId(A), A);
  assert.equal(validateAnnotationSubmissionKey("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  for (const invalid of ["annotation_1", "ann_1", "550e8400-e29b-41d4-a716-446655440000", "ann_550e8400-e29b-11d4-a716-446655440000"]) assert.throws(() => validateAnnotationId(invalid), /批注标识无效/);
});

test("annotation content accepts compact Markdown and rejects unsupported structures", () => {
  const valid = "普通 **粗体** *斜体* ~~删除线~~ `代码` [链接](https://example.com)\n\n> 引用\n\n1. 列表\n\n```ts\nconst x = 1\n```";
  assert.equal(validateAnnotationContent(valid), valid);
  for (const invalid of ["   ", "# 标题", "| A |\n| - |\n| B |", "![图](/api/assets/x)", "[附件](/api/assets/x)", "<span>HTML</span>", `:annotation[伪造]{#${A}}`]) {
    assert.throws(() => validateAnnotationContent(invalid), /批注内容/);
  }
});

test("reply notification targets the actual recipient and suppresses self notifications", () => {
  assert.equal(resolveAnnotationReplyRecipient({ actorUserId: "c", annotationAuthorId: "a", replyToUserId: "b" }), "b");
  assert.equal(resolveAnnotationReplyRecipient({ actorUserId: "b", annotationAuthorId: "a", replyToUserId: "b" }), null);
});

test("anchor and post ownership invariants reject forged IDs", () => {
  assert.doesNotThrow(() => assertAnchorInvariant([A], [A]));
  assert.throws(() => assertAnchorInvariant([A], []), /锚点状态不一致/);
  assert.throws(() => assertAnchorInvariant([A, A], [A]), /锚点状态不一致/);
  assert.doesNotThrow(() => assertAnnotationBelongsToPost("p", "p"));
  assert.throws(() => assertAnnotationBelongsToPost("other", "p"), /不属于当前帖子/);
});
