import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adminDateBounds, adminUrl, parseAdminQuery } from "../lib/admin/query.ts";

test("admin query defaults to the overview and safely normalizes unknown values", () => {
  assert.deepEqual(parseAdminQuery({}), {
    section: "overview",
    type: "posts",
    status: "normal",
    q: "",
    sort: "newest",
    from: "",
    to: "",
    page: 1,
  });
  assert.deepEqual(parseAdminQuery({ type: "unknown", status: "gone", page: "-4" }), {
    section: "content",
    type: "posts",
    status: "normal",
    q: "",
    sort: "newest",
    from: "",
    to: "",
    page: 1,
  });
});

test("admin query keeps content filters and emits compact restorable URLs", () => {
  const view = parseAdminQuery({
    type: "annotations",
    status: "hidden",
    q: "  证据  ",
    sort: "oldest",
    from: "2026-09-30",
    to: "2026-09-01",
    page: "3",
  });
  assert.equal(view.section, "content");
  assert.equal(view.q, "证据");
  assert.equal(view.from, "2026-09-01");
  assert.equal(view.to, "2026-09-30");
  assert.equal(
    adminUrl(view),
    "/admin?type=annotations&status=hidden&q=%E8%AF%81%E6%8D%AE&sort=oldest&from=2026-09-01&to=2026-09-30&page=3",
  );
  assert.equal(
    adminUrl(view, { status: "normal", page: 1 }),
    "/admin?type=annotations&status=normal&q=%E8%AF%81%E6%8D%AE&sort=oldest&from=2026-09-01&to=2026-09-30",
  );
  assert.equal(adminUrl(view, { section: "overview" }), "/admin");
});

test("admin date filters use inclusive Beijing calendar days", () => {
  const bounds = adminDateBounds({ from: "2026-09-01", to: "2026-09-30" });
  assert.equal(bounds.start?.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(bounds.endExclusive?.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(parseAdminQuery({ from: "2026-02-30", to: "not-a-date" }).from, "");
});

test("admin content uses one type navigation, semantic tables, and app-owned confirmations", async () => {
  const [page, shell, search, allowlist, table, bulk] = await Promise.all([
    readFile(new URL("../app/(site)/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/admin-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/admin-search-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/allowlist-forms.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/admin-content-table.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/admin-bulk-selection.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /aria-label="管理后台"/);
  assert.doesNotMatch(page, /aria-label="内容类型"/);
  assert.match(page, /<AdminContentTable/);
  assert.match(table, /<table className=/);
  assert.match(table, /data-admin-select-all/);
  assert.match(bulk, /批量永久删除/);
  assert.match(search, /aria-label="清除搜索"/);
  assert.match(search, /type="date"/);
  assert.match(allowlist, /<ModalDialog/);
  assert.match(allowlist, /已经发布的帖子、回复和批注会继续保留/);
  assert.match(table, /type="checkbox"/);
});
