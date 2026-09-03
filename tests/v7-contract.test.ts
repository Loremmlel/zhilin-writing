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
  assert.match(matrix, /BLOCKED.*ERR_BLOCKED_BY_CLIENT/s);
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
