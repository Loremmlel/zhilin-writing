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

test("production artifact contains V4 lifecycle placeholders, confirmations, and moderation", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.match(source, /该帖子已被作者删除/);
  assert.match(source, /该回复已被管理员隐藏/);
  assert.match(source, /其他用户已经发布的回复仍会保留/);
  assert.match(source, /管理员操作记录/);
  assert.match(source, /恢复作者删除/);
  assert.match(styles, /status-pill--deleted/);
  assert.match(styles, /deleted-placeholder/);
});

test("production artifact contains V5 annotation reading, discussion, and edit protection", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.match(source, /添加批注/);
  assert.match(source, /正文批注讨论/);
  assert.match(source, /批注正文编辑保护将在下一版本完成/);
  assert.match(source, /批注状态变化/);
  assert.match(source, /Annotation replies/);
  assert.match(styles, /annotation-range/);
  assert.match(styles, /annotation-connectors/);
  assert.match(styles, /annotation-sheet-surface/);
});

test("production artifact contains the V5.5 DOCX import entry and Preview workspace", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.match(source, /从 DOCX 导入/);
  assert.match(source, /选择 DOCX 文件/);
  assert.match(source, /解析进度/);
  assert.match(source, /Word 作者关联/);
  assert.match(source, /此 DOCX 含正文批注。导入后正文将在 V6 AnnotationGuard 完成前暂时锁定编辑。/);
  assert.match(source, /取消导入/);
  assert.match(source, /确认导入/);
  assert.match(styles, /docx-import-workspace/);
  assert.match(styles, /docx-import-warning-summary/);
});

test("production artifact contains V6 route loading and safe error recovery", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.match(source, /页面暂时无法显示/);
  assert.match(source, /重新加载/);
  assert.match(source, /返回首页/);
  assert.match(source, /页面不存在/);
  assert.doesNotMatch(source, /错误堆栈|数据库查询失败|D1_ERROR/);
  assert.match(styles, /skeleton-block/);
  assert.match(styles, /route-error-card/);
  assert.match(styles, /#nprogress/);
});
