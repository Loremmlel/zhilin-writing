import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("V7 keeps an executable release matrix and the required final report sections", async () => {
  const [matrix, report] = await Promise.all([
    source("../docs/testing/v7-regression-matrix.md"),
    source("../docs/v7-release-hardening-report.md"),
  ]);

  for (const area of ["Auth", "Post", "Reply", "Annotation", "DOCX", "Assets", "Slow network", "Failure injection", "Deployment gate"]) {
    assert.match(matrix, new RegExp(`## ${area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  for (let section = 1; section <= 16; section += 1) {
    assert.match(report, new RegExp(`## ${section}\\.`));
  }
  assert.match(matrix, /BLOCKED[\s\S]*ERR_BLOCKED_BY_CLIENT/);
  assert.doesNotMatch(report, /阶段：完成/);
});

test("every V7 route-loading contract has a real route boundary", async () => {
  const routes = [
    "../app/(site)/loading.tsx",
    "../app/(site)/posts/[id]/loading.tsx",
    "../app/(site)/users/[id]/loading.tsx",
    "../app/(site)/notifications/loading.tsx",
    "../app/(site)/search/loading.tsx",
    "../app/(site)/tags/[name]/loading.tsx",
    "../app/(site)/admin/loading.tsx",
    "../app/(site)/admin/revisions/[postId]/loading.tsx",
  ];
  const boundaries = await Promise.all(routes.map(source));
  boundaries.forEach((boundary, index) => {
    assert.match(boundary, /Skeleton/ , `${routes[index]} must render a skeleton`);
  });
});

test("the V7 plan preserves one canonical author-delete and admin-hide vocabulary", async () => {
  const [postViews, annotationViews, design] = await Promise.all([
    source("../lib/lifecycle/views.ts"),
    source("../lib/annotations/lifecycle.ts"),
    source("../docs/superpowers/specs/2026-09-03-release-hardening-v7-design.md"),
  ]);

  assert.match(postViews, /该帖子已被作者删除。/);
  assert.match(postViews, /该帖子已被管理员隐藏。/);
  assert.match(annotationViews, /该回复已被作者删除。/);
  assert.match(annotationViews, /该回复已被管理员隐藏。/);
  assert.match(design, /该内容存在于历史版本中，但当前版本已不再包含它。/);
});

test("asset failures remain per-file and unsafe attachments are downloaded", async () => {
  const [editor, postForm, assetRoute, storage] = await Promise.all([
    source("../components/editor/markdown-editor.tsx"),
    source("../components/editor/post-editor-form.tsx"),
    source("../app/api/assets/[id]/route.ts"),
    source("../lib/assets/storage.ts"),
  ]);

  assert.match(editor, /Promise\.allSettled/);
  assert.match(editor, /status: "failed"/);
  assert.doesNotMatch(editor, /controller\.abort\(\);[\s\S]{0,120}setImageUploadTasks/);
  assert.match(postForm, /type="file" multiple/);
  assert.match(postForm, /uploadAttachment\(task\.file, task\.id\)/);
  assert.match(assetRoute, /x-content-type-options/);
  assert.match(assetRoute, /\? "inline" : "attachment"/);
  assert.match(storage, /await env\.BUCKET\.delete\(r2Key\)/);
});

test("V7 polish keeps lifecycle states out of 404 and provides local recovery and mobile containment", async () => {
  const [notFound, styles, notifications, annotationThread, admin, profile, post, revision] = await Promise.all([
    source("../app/not-found.tsx"),
    source("../app/globals.css"),
    source("../app/(site)/notifications/page.tsx"),
    source("../components/annotations/annotation-thread.tsx"),
    source("../app/(site)/admin/page.tsx"),
    source("../app/(site)/users/[id]/page.tsx"),
    source("../app/(site)/posts/[id]/page.tsx"),
    source("../app/(site)/admin/revisions/[postId]/page.tsx"),
  ]);

  assert.match(notFound, /没有找到这个页面/);
  assert.doesNotMatch(notFound, /不可见|已删除|已隐藏/);
  assert.match(styles, /\.markdown-body table[^}]*max-width: 100%[^}]*overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*min-height: 44px/);
  assert.match(styles, /:focus-visible[^}]*outline/);
  assert.match(styles, /skeleton-reveal 0s \.16s both/);
  assert.match(annotationThread, /还没有回复。/);
  assert.match(admin, /没有被作者删除的/);
  assert.match(admin, /没有被管理员隐藏的/);
  assert.match(profile, />帖子<[\s\S]*>动态</);
  for (const region of [notifications, profile, post, admin, revision]) {
    assert.match(region, /RegionErrorBoundary/);
  }
});
