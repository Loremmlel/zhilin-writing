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

  for (const area of [
    "Auth",
    "Post",
    "Reply",
    "Annotation",
    "DOCX",
    "Assets",
    "Slow network",
    "Failure injection",
    "Deployment gate",
  ]) {
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
    assert.match(boundary, /Skeleton/, `${routes[index]} must render a skeleton`);
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
  assert.match(postForm, /type="file"\s+multiple/);
  assert.match(postForm, /uploadAttachment\(task\.file, task\.id\)/);
  assert.match(assetRoute, /x-content-type-options/);
  assert.match(assetRoute, /\? "inline" : "attachment"/);
  assert.match(storage, /await env\.BUCKET\.delete\(r2Key\)/);
});

test("V7 polish keeps lifecycle states out of 404 and provides local recovery and mobile containment", async () => {
  const [notFound, styles, notifications, annotationThread, admin, profile, post, revision] =
    await Promise.all([
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
  assert.match(styles, /skeleton-reveal 0s 0\.16s both/);
  assert.match(annotationThread, /还没有回复。/);
  assert.match(admin, /没有被作者删除的/);
  assert.match(admin, /没有被管理员隐藏的/);
  assert.match(profile, />\s*帖子\s*<[\s\S]*>\s*动态\s*</);
  for (const region of [notifications, profile, post, admin, revision]) {
    assert.match(region, /RegionErrorBoundary/);
  }
});

test("ordinary post reading defers the large editor bundle until a composer opens", async () => {
  const [
    readingLayout,
    editorLayout,
    annotationReply,
    replyForm,
    replyList,
    lazyEditor,
    lazyReply,
  ] = await Promise.all([
    source("../components/annotations/annotation-reading-layout.tsx"),
    source("../components/editor/annotated-editor-layout.tsx"),
    source("../components/annotations/annotation-reply-form.tsx"),
    source("../components/reply-form.tsx"),
    source("../components/reply-list.tsx"),
    source("../components/editor/lazy-markdown-editor.tsx"),
    source("../components/lazy-reply-form.tsx"),
  ]);

  for (const sourceText of [readingLayout, annotationReply, replyForm]) {
    assert.doesNotMatch(sourceText, /import \{ MarkdownEditor \} from/);
    assert.match(sourceText, /LazyMarkdownEditor/);
  }
  assert.match(replyList, /LazyReplyForm/);
  assert.match(lazyEditor, /import\("\.\/markdown-editor"\)/);
  assert.match(lazyReply, /import\("\.\/reply-form"\)/);
  assert.doesNotMatch(`${readingLayout}\n${editorLayout}`, /addEventListener\("scroll"/);
});

test("annotation reading activates on click without duplicating selected text in threads", async () => {
  const [readingLayout, annotationThread, annotationSheet] = await Promise.all([
    source("../components/annotations/annotation-reading-layout.tsx"),
    source("../components/annotations/annotation-thread.tsx"),
    source("../components/annotations/annotation-sheet.tsx"),
  ]);

  assert.match(readingLayout, /onClick=\{\(event\) =>/);
  assert.match(readingLayout, /layoutAnnotationCards\(anchors, cardHeights, 8\)/);
  assert.doesNotMatch(readingLayout, /onPointerOver=/);
  assert.doesNotMatch(annotationThread, /annotation-card-excerpt/);
  assert.doesNotMatch(annotationSheet, /选中文字/);
});

test("home cards, admin tabs, and the compact header keep their interaction contract", async () => {
  const [styles, card, admin] = await Promise.all([
    source("../app/globals.css"),
    source("../components/post-card.tsx"),
    source("../app/(site)/admin/page.tsx"),
  ]);

  assert.match(card, /className="post-title-link"/);
  assert.match(styles, /\.post-title-link::after[^}]*position: absolute[^}]*inset: 0/);
  assert.match(styles, /\.post-card :is\(\.author-link, \.reply-count, \.tag\)[^}]*z-index: 1/);
  assert.match(styles, /\.admin-page \.list-tabs[^}]*overflow-x: auto[^}]*overflow-y: hidden/);
  assert.doesNotMatch(styles, /\.admin-page \.list-tabs[^}]*scrollbar-gutter: stable/);
  assert.match(styles, /\.button--write[^}]*white-space: nowrap/);
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.header-actions\s*\{[^}]*gap:\s*8px;[^}]*\}[\s\S]*\.account-menu-trigger\s*\{[^}]*min-width:\s*44px/,
  );
  assert.match(admin, /所属帖子：用户已删除/);
  assert.match(admin, /所属帖子：管理员已隐藏/);
});
