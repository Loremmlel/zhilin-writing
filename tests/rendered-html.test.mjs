import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Worker } from "node:worker_threads";

async function builtServerSource() {
  const root = new URL("../dist/server/", import.meta.url);
  const files = await readdir(root, { recursive: true });
  const chunks = await Promise.all(
    files
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFile(new URL(file, root), "utf8")),
  );
  return chunks.join("\n");
}

async function builtCssSource() {
  const root = new URL("../dist/client/assets/", import.meta.url);
  const files = await readdir(root);
  const chunks = await Promise.all(
    files
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFile(new URL(file, root), "utf8")),
  );
  return chunks.join("\n");
}

async function builtDocxWorkerUrl() {
  const root = new URL("../dist/client/assets/", import.meta.url);
  const files = await readdir(root);
  const filename = files.find((file) => /^docx-import\.worker-.*\.js$/.test(file));
  assert.ok(filename, "production build did not emit the DOCX worker");
  return new URL(filename, root);
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
  assert.match(source, /该回复已被作者删除/);
  assert.match(styles, /reply-highlight/);
});

test("production artifact contains administrator revision preview and restore surfaces", async () => {
  const source = await builtServerSource();
  assert.match(source, /Post revisions/);
  assert.match(source, /历史版本预览/);
  assert.match(source, /恢复此版本/);
  assert.match(source, /当前版本/);
});

test("production artifact keeps administrator chrome within the viewport", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.doesNotMatch(source, /返回总览/);
  assert.match(source, /北京时间 ·/);
  assert.match(styles, /\.site-main:has\(\.admin-shell\)\+\.site-footer\{display:none\}/);
  assert.match(styles, /\.admin-shell\{[^}]*width:min\(1800px,100%\)/);
  assert.match(styles, /\.admin-sidebar\{[^}]*height:100%[^}]*overflow-y:auto[^}]*\}/);
  assert.match(styles, /\.site-shell:has\(\.admin-shell\)\{[^}]*height:100dvh[^}]*overflow:hidden/);
  assert.match(styles, /\.admin-page\{[^}]*height:100%[^}]*overflow:hidden/);
  assert.match(styles, /\.admin-table-scroll\{[^}]*overflow:auto/);
  assert.match(styles, /\.admin-table-operation\{[^}]*position:sticky!important/);
  assert.match(styles, /\.admin-table-operation\{[^}]*right:0/);
  assert.match(styles, /\.admin-table-operation\{[^}]*width:266px/);
  assert.match(styles, /\.admin-toolbar \.text-input\{[^}]*height:36px/);
  assert.match(styles, /\.admin-preview-body,\.admin-preview-quote\{[^}]*height:3em/);
  assert.match(styles, /\.admin-preview-body,\.admin-preview-quote\{[^}]*line-height:1\.5/);
  assert.match(styles, /\.admin-page-header\{[^}]*margin-bottom:18px[^}]*\}/);
});

test("production artifact contains administrator filters, bulk actions, and purge confirmations", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.match(source, /批量永久删除/);
  assert.match(source, /日期按北京时间计算/);
  assert.match(source, /此操作不可撤销/);
  assert.match(source, /永久删除批注/);
  assert.match(styles, /admin-preview-body/);
  assert.match(styles, /admin-bulk-scope/);
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

test("production artifact contains V6 annotation reading, discussion, and guarded editing", async () => {
  const [source, styles] = await Promise.all([builtServerSource(), builtCssSource()]);
  assert.match(source, /添加批注/);
  assert.match(source, /正文批注讨论/);
  assert.match(source, /继续修改并撤下批注/);
  assert.match(source, /正文批注，只读/);
  assert.match(source, /批注状态变化/);
  assert.match(source, /批注回复/);
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
  assert.match(
    source,
    /此 DOCX 含正文批注。导入后可继续编辑正文；修改批注端点时系统会先要求确认。/,
  );
  assert.match(source, /取消导入/);
  assert.match(source, /确认导入/);
  assert.match(styles, /docx-import-workspace/);
  assert.match(styles, /docx-import-warning-summary/);
});

test("production DOCX worker loads without DOM globals", async () => {
  const worker = new Worker(await builtDocxWorkerUrl());
  await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`DOCX worker exited with code ${code}`));
    });
  });
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
  assert.match(styles, /#route-progress/);
  assert.doesNotMatch(styles, /#nprogress/);
});
