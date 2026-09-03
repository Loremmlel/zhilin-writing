import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adminUrl, parseAdminQuery } from "../lib/admin/query.ts";

test("admin query defaults to the overview and safely normalizes unknown values", () => {
  assert.deepEqual(parseAdminQuery({}), {
    section: "overview",
    type: "posts",
    status: "normal",
    q: "",
    sort: "newest",
    page: 1,
  });
  assert.deepEqual(parseAdminQuery({ type: "unknown", status: "gone", page: "-4" }), {
    section: "content",
    type: "posts",
    status: "normal",
    q: "",
    sort: "newest",
    page: 1,
  });
});

test("admin query keeps content filters and emits compact restorable URLs", () => {
  const view = parseAdminQuery({
    type: "annotations",
    status: "hidden",
    q: "  证据  ",
    sort: "oldest",
    page: "3",
  });
  assert.equal(view.section, "content");
  assert.equal(view.q, "证据");
  assert.equal(
    adminUrl(view),
    "/admin?type=annotations&status=hidden&q=%E8%AF%81%E6%8D%AE&sort=oldest&page=3",
  );
  assert.equal(
    adminUrl(view, { status: "normal", page: 1 }),
    "/admin?type=annotations&status=normal&q=%E8%AF%81%E6%8D%AE&sort=oldest",
  );
  assert.equal(adminUrl(view, { section: "overview" }), "/admin");
});

test("admin content uses one type navigation, semantic tables, and app-owned confirmations", async () => {
  const [page, shell, search, allowlist] = await Promise.all([
    readFile(new URL("../app/(site)/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/admin-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/admin-search-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/allowlist-forms.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /aria-label="管理后台"/);
  assert.doesNotMatch(page, /aria-label="内容类型"/);
  assert.match(page, /<table className="admin-table/);
  assert.match(search, /aria-label="清除搜索"/);
  assert.match(allowlist, /<ModalDialog/);
  assert.match(allowlist, /已经发布的帖子、回复和批注会继续保留/);
  assert.doesNotMatch(`${page}\n${allowlist}`, /<input[^>]+type="checkbox"/);
});
