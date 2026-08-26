import assert from "node:assert/strict";
import test from "node:test";

import {
  assetMarkdown,
  canEditPost,
  draftKey,
  classifyUpload,
  normalizeEmail,
  normalizeReplyTarget,
  validateUpload,
  validateDisplayName,
  validatePostInput,
  validateReplyMarkdown,
} from "../lib/domain/rules.ts";

test("normalizeEmail trims and lowercases identity keys", () => {
  assert.equal(normalizeEmail("  Owner@Example.COM "), "owner@example.com");
});

test("validateDisplayName rejects empty and overlong names", () => {
  assert.equal(validateDisplayName("  "), "显示名称不能为空");
  assert.equal(validateDisplayName("清晏"), null);
  assert.equal(validateDisplayName("一".repeat(31)), "显示名称不能超过 30 个字符");
});

test("validatePostInput accepts zero to five distinct tags", () => {
  assert.deepEqual(
    validatePostInput({ title: "雨天随笔", markdown: "一段正文", tags: ["生活", "随笔"] }),
    { title: "雨天随笔", markdown: "一段正文", tags: ["生活", "随笔"] },
  );
  assert.throws(
    () => validatePostInput({ title: "标题", markdown: "正文", tags: ["一", "二", "三", "四", "五", "六"] }),
    /最多选择 5 个标签/,
  );
  assert.throws(
    () => validatePostInput({ title: "标题", markdown: "正文", tags: ["随笔", "随笔"] }),
    /标签不能重复/,
  );
});

test("post editing is limited to the author", () => {
  assert.equal(canEditPost("user-a", "user-a"), true);
  assert.equal(canEditPost("user-a", "user-b"), false);
});

test("reply Markdown is required and bounded", () => {
  assert.equal(validateReplyMarkdown(" **谢谢** "), "**谢谢**");
  assert.throws(() => validateReplyMarkdown("  "), /回复不能为空/);
  assert.throws(() => validateReplyMarkdown("字".repeat(10001)), /不能超过 10000/);
});

test("nested targets remain at the root visual level", () => {
  assert.deepEqual(
    normalizeReplyTarget({ id: "top", rootReplyId: null, authorId: "user-a" }),
    { rootReplyId: "top", replyToReplyId: "top", replyToUserId: "user-a" },
  );
  assert.deepEqual(
    normalizeReplyTarget({ id: "nested", rootReplyId: "top", authorId: "user-b" }),
    { rootReplyId: "top", replyToReplyId: "nested", replyToUserId: "user-b" },
  );
});

test("draft keys are stable and scoped to one user and post", () => {
  assert.equal(draftKey("user-a", "new"), "zhilin:draft:user-a:new");
  assert.notEqual(draftKey("user-a", "new"), draftKey("user-b", "new"));
});

test("uploads are classified and inserted with standard Markdown", () => {
  assert.equal(classifyUpload("image/jpeg"), "image");
  assert.equal(classifyUpload("application/pdf"), "attachment");
  assert.equal(assetMarkdown({ kind: "image", filename: "雨.jpg", url: "/api/assets/a1" }), "![雨.jpg](/api/assets/a1)");
  assert.equal(assetMarkdown({ kind: "attachment", filename: "日记.docx", url: "/api/assets/a2" }), "[日记.docx](/api/assets/a2)");
});

test("upload validation rejects empty and oversized files", () => {
  assert.equal(validateUpload({ size: 1024, mimeType: "image/png" }), null);
  assert.equal(validateUpload({ size: 0, mimeType: "image/png" }), "文件不能为空");
  assert.equal(validateUpload({ size: 21 * 1024 * 1024, mimeType: "application/pdf" }), "文件不能超过 20 MB");
});
