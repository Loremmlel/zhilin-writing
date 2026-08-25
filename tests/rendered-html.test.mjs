import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function builtServerSource() {
  const root = new URL("../dist/server/", import.meta.url);
  const files = await readdir(root, { recursive: true });
  const chunks = await Promise.all(
    files.filter((file) => file.endsWith(".js")).map((file) => readFile(new URL(file, root), "utf8")),
  );
  return chunks.join("\n");
}

async function builtCssSource() {
  const root = new URL("../dist/client/assets/", import.meta.url);
  const files = await readdir(root);
  const chunks = await Promise.all(
    files.filter((file) => file.endsWith(".css")).map((file) => readFile(new URL(file, root), "utf8")),
  );
  return chunks.join("\n");
}

test("production artifact contains private-community metadata and denial copy", async () => {
  const source = await builtServerSource();
  assert.match(source, /知临中学/);
  assert.match(source, /只对管理员邀请的少数成员开放/);
  assert.doesNotMatch(source, /codex-preview/);
});

test("production artifact contains the dispatcher-owned ChatGPT sign-in path", async () => {
  const source = await builtServerSource();
  assert.match(source, /\/signin-with-chatgpt/);
  assert.match(source, /oai-authenticated-user-email/);
});

test("production artifact contains the V2 activity and notification surfaces", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.match(source, /Activity/);
  assert.match(source, /全部标记已读/);
  assert.match(source, /该回复已经被删除/);
  assert.match(styles, /reply-highlight/);
});

test("production artifact contains administrator revision preview and restore surfaces", async () => {
  const source = await builtServerSource();
  assert.match(source, /Post revisions/);
  assert.match(source, /历史版本预览/);
  assert.match(source, /恢复此版本/);
  assert.match(source, /当前版本/);
});
