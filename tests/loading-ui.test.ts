import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8").catch(() => "");
}

test("approved route segments render shared geometry-matched loading states", async () => {
  const routes = [
    ["../app/(site)/loading.tsx", "PostListSkeleton"],
    ["../app/(site)/posts/[id]/loading.tsx", "PostDetailSkeleton"],
    ["../app/(site)/users/[id]/loading.tsx", "ProfileSkeleton"],
    ["../app/(site)/notifications/loading.tsx", "NotificationsSkeleton"],
    ["../app/(site)/search/loading.tsx", "SearchSkeleton"],
    ["../app/(site)/admin/loading.tsx", "AdminSkeleton"],
    ["../app/(site)/admin/revisions/[postId]/loading.tsx", "RevisionSkeleton"],
    ["../app/(site)/tags/[name]/loading.tsx", "TagSkeleton"],
  ] as const;

  for (const [path, component] of routes) {
    const contents = await source(path);
    assert.match(contents, new RegExp(`\\b${component}\\b`), `${path} should use ${component}`);
    assert.doesNotMatch(contents, />\s*Loading\.\.\.\s*</i);
  }
});

test("route progress is a non-blocking two-pixel accent bar without a spinner", async () => {
  const [component, layout, packageJson, styles] = await Promise.all([
    source("../components/loading/route-progress.tsx"),
    source("../app/layout.tsx"),
    source("../package.json"),
    source("../app/globals.css"),
  ]);

  assert.match(packageJson, /"nextjs-toploader": "3\.9\.17"/);
  assert.match(component, /height=\{2\}/);
  assert.match(component, /showSpinner=\{false\}/);
  assert.match(component, /shadow=\{false\}/);
  assert.match(component, /showForHashAnchor=\{false\}/);
  assert.match(component, /color="var\(--green\)"/);
  assert.match(layout, /<RouteProgress\s*\/>/);
  assert.match(styles, /#nprogress[^}]*pointer-events:\s*none/);
});

test("targeted Suspense boundaries keep the shared shell and independent regions available", async () => {
  const pages = await Promise.all([
    source("../app/(site)/posts/[id]/page.tsx"),
    source("../app/(site)/notifications/page.tsx"),
    source("../app/(site)/users/[id]/page.tsx"),
    source("../app/(site)/admin/page.tsx"),
    source("../app/(site)/admin/revisions/[postId]/page.tsx"),
  ]);

  for (const contents of pages) assert.match(contents, /<Suspense\s+fallback=/);
  assert.match(pages[0]!, /PostBodySkeleton/);
  assert.match(pages[0]!, /DiscussionSkeleton/);
  assert.match(pages[1]!, /NotificationsListSkeleton/);
  assert.match(pages[2]!, /ProfileContentSkeleton/);
  assert.match(pages[3]!, /AdminListSkeleton/);
  assert.match(pages[4]!, /RevisionPreviewSkeleton/);
});

test("error boundaries offer safe recovery without rendering internal error details", async () => {
  const paths = [
    "../app/error.tsx",
    "../app/global-error.tsx",
    "../app/(site)/error.tsx",
  ];
  const boundaries = await Promise.all(paths.map(source));
  const errorView = await source("../components/error-state.tsx");
  const notFound = await source("../app/not-found.tsx");

  for (const [index, contents] of boundaries.entries()) {
    assert.match(contents, /reset=\{reset\}/, `${paths[index]} should expose Retry`);
    assert.doesNotMatch(contents, /error\.(?:message|stack|cause)|JSON\.stringify\(error\)/);
  }
  assert.match(boundaries[1]!, /<html\s+lang="zh-CN">/);
  assert.match(boundaries[1]!, /<body/);
  assert.match(boundaries[2]!, /登录状态/);
  assert.match(errorView, /重新加载/);
  assert.match(errorView, /href="\/"/);
  assert.match(errorView, /返回首页/);
  assert.match(notFound, /页面不存在/);
  assert.match(notFound, /href="\/"/);
});

test("loading motion has an explicit reduced-motion fallback", async () => {
  const styles = await source("../app/globals.css");
  assert.match(styles, /@keyframes\s+skeleton-shimmer/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.skeleton-block::after\s*\{[^}]*animation:\s*none/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?#nprogress\s+\.bar\s*\{[^}]*transition:\s*none/);
  assert.match(styles, /scroll-behavior:\s*auto\s*!important/);
});

test("standalone region skeletons announce busy state without exposing decorative geometry", async () => {
  const skeletons = await source("../components/loading/skeletons.tsx");
  assert.match(skeletons, /aria-busy="true"/);
  assert.match(skeletons, /aria-live="polite"/);
  assert.match(skeletons, /aria-hidden="true"/);
  assert.match(skeletons, /className="sr-only"/);
});
