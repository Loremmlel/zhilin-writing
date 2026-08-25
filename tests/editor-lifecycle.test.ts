import assert from "node:assert/strict";
import test from "node:test";

test("autosaved Markdown changes preserve the active editor session", async () => {
  const lifecycleModule = await import("../lib/editor/lifecycle.ts").catch(() => null);
  assert.ok(lifecycleModule, "the editor lifecycle policy must exist");

  const beforeSave = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 0,
    markdown: "正在输入",
  });
  const afterSave = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 0,
    markdown: "正在输入更多内容",
  });

  assert.equal(afterSave, beforeSave);
});

test("an explicit reset creates a new editor session", async () => {
  const lifecycleModule = await import("../lib/editor/lifecycle.ts").catch(() => null);
  assert.ok(lifecycleModule, "the editor lifecycle policy must exist");

  const current = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 0,
    markdown: "正文",
  });
  const reset = lifecycleModule.editorSessionKey({
    compact: false,
    resetRevision: 1,
    markdown: "正文\n\n[附件](/api/assets/a1)",
  });

  assert.notEqual(reset, current);
});
