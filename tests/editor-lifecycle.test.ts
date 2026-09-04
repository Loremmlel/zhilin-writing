import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("post editing mounts one editor only after local draft hydration", async () => {
  const source = await readFile(
    new URL("../components/editor/post-editor-form.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const editor = hydrated \? \(/);
  assert.doesNotMatch(source, /hydrated \? "ready" : "initial"/);
});

test("editor initialization keeps a visible loading and retry state", async () => {
  const source = await readFile(
    new URL("../components/editor/markdown-editor.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /initializationState/);
  assert.match(source, /\.create\(\)[\s\S]*?\.catch\(/);
  assert.match(source, /正文编辑器加载失败，帖子内容没有丢失。/);
});
