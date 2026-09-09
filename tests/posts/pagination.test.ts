import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { pageBounds, pageHref, paginationPages, parsePage } from "../../lib/pagination.ts";
import { useQueryDatabase } from "../helpers/query-database.ts";

// Execute the production query module against migrated SQLite; only its D1 transport is replaced.
const root = new URL("../../", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./index" && context.parentURL?.endsWith("/db/queries.ts"))
      return {
        url: new URL("../helpers/query-database.ts", import.meta.url).href,
        shortCircuit: true,
      };
    const candidate = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), root)
      : specifier.startsWith(".") && context.parentURL
        ? new URL(specifier, context.parentURL)
        : null;
    if (
      candidate?.protocol === "file:" &&
      !/\.[a-z]+$/.test(candidate.pathname) &&
      existsSync(new URL(`${candidate.href}.ts`))
    )
      return { url: `${candidate.href}.ts`, shortCircuit: true };
    return next(specifier, context);
  },
});
const queries = await import("../../db/queries.ts");
hooks.deregister();

test("pagination rejects malformed pages and preserves filters in canonical links", () => {
  for (const value of [
    undefined,
    "",
    "0",
    "-1",
    "1.5",
    "1e2",
    "2x",
    " 2",
    "02",
    "9007199254740992",
    ["2"],
  ])
    assert.equal(parsePage(value), 1);
  assert.equal(parsePage("23"), 23);
  for (const total of [0, 1, 20, 21, 40, 41]) {
    const bounds = pageBounds(total, 999);
    assert.equal(bounds.page, Math.max(1, Math.ceil(total / 20)));
    assert.equal(bounds.offset, (bounds.page - 1) * 20);
  }
  assert.equal(
    pageHref("/search", { q: "校园", sort: undefined }, 2),
    "/search?q=%E6%A0%A1%E5%9B%AD&page=2",
  );
  assert.deepEqual(paginationPages(5, 10), [1, "gap", 4, 5, 6, "gap", 10]);
});

test("production lists traverse beyond old caps, keep stable ties, and clamp after visibility changes", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir(new URL("../../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    for (const statement of (
      await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8")
    )
      .split("--> statement-breakpoint")
      .filter((value) => value.trim()))
      db.exec(statement);
  }
  let maxColumns = 0;
  let calls = 0;
  useQueryDatabase(
    drizzle(async (sql, params, method) => {
      calls++;
      const statement = db.prepare(sql);
      maxColumns = Math.max(maxColumns, statement.columns().length);
      if (method === "run") {
        statement.run(...(params as []));
        return { rows: [] };
      }
      statement.setReturnArrays(true);
      return { rows: statement.all(...(params as [])) as unknown as unknown[][] };
    }),
  );
  try {
    db.exec(
      "INSERT INTO users(id,email_key,display_name,bio,joined_at,updated_at) VALUES ('author','author@example.test','作者','',1,1),('reader','reader@example.test','读者','',1,1)",
    );
    db.exec(
      "INSERT INTO tags(id,name,normalized_name,created_at) VALUES ('t1','校园','校园',1),('t2','随笔','随笔',1)",
    );
    const insertPost = db.prepare(
      "INSERT INTO posts(id,author_id,title,markdown,search_text,published_at,last_activity_at) VALUES (?,'author',?,'正文','校园文字',1000,1000)",
    );
    for (let i = 1; i <= 65; i++) {
      const id = `p${String(i).padStart(3, "0")}`;
      insertPost.run(id, `文章${i}`);
      db.prepare("INSERT INTO post_tags(post_id,tag_id) VALUES (?,'t1'),(?,'t2')").run(id, id);
      db.prepare(
        "INSERT INTO activity_events(id,actor_user_id,event_type,post_id,created_at) VALUES (?,'author','POST_CREATED',?,1000)",
      ).run(`e${id}`, id);
      db.prepare(
        "INSERT INTO notifications(id,recipient_user_id,actor_user_id,event_id,notification_type,post_id,created_at) VALUES (?,'reader','author',?,'POST_REPLY_RECEIVED',?,1000)",
      ).run(`n${id}`, `e${id}`, id);
    }
    db.exec(
      "INSERT INTO post_revisions(id,post_id,revision_number,kind,title,markdown,created_at,created_by_user_id) VALUES ('r1','p065',1,'CONTENT_EDIT','文章65','正文',1000,'author')",
    );
    db.exec(
      "INSERT INTO annotations(id,post_id,author_id,content_markdown,original_selected_text,created_at,created_on_revision_id,submission_key) VALUES ('a1','p065','author','批注一','正文',1000,'r1','s1'),('a2','p065','author','批注二','正文',1001,'r1','s2')",
    );
    db.exec(
      "INSERT INTO post_annotation_anchors(post_id,annotation_id) VALUES ('p065','a1'),('p065','a2')",
    );
    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const result = await queries.listPostsPage({ page, tagName: "校园" });
      assert.equal(result.total, 65);
      assert.equal(result.page, page);
      assert.ok(result.items.every((item) => item.tags.length === 2 && item.replyCount === 0));
      assert.equal(
        result.items.reduce((total, item) => total + item.annotationCount, 0),
        page === 1 ? 2 : 0,
      );
      seen.push(...result.items.map((item) => item.post.id));
    }
    assert.equal(new Set(seen).size, 65);
    assert.equal(seen[0], "p065");
    assert.equal(seen.at(-1), "p001");
    assert.equal(
      (await queries.listPostsPage({ sort: "active", page: 2 })).items[0].post.id,
      "p045",
    );
    assert.equal((await queries.listPostsPage({ query: "未匹配", page: 90 })).page, 1);
    assert.equal((await queries.listPostsPage({ tagName: "不存在" })).total, 0);
    assert.equal((await queries.listPostsPage({ authorId: "reader" })).total, 0);
    calls = 0;
    await queries.listPostsPage();
    assert.equal(calls, 5, "count, page, batched tags, reply counts and annotation counts only");
    db.exec("UPDATE posts SET hidden_at=2 WHERE id >= 'p041'");
    const clamped = await queries.listPostsPage({ page: 4 });
    assert.equal(clamped.total, 40);
    assert.equal(clamped.page, 2);
    assert.equal(clamped.items.length, 20);
    db.exec("UPDATE posts SET deleted_at=2 WHERE id='p040'");
    assert.equal((await queries.listPostsPage({ tagName: "校园" })).total, 39);
    const activity = await queries.listUserActivityPage("author", 4);
    assert.equal(activity.total, 65);
    assert.equal(activity.items.length, 5);
    const hiddenActivity = await queries.listUserActivityPage("author", 1);
    assert.equal(hiddenActivity.items[0].post?.title, "");
    db.exec("UPDATE activity_events SET invalidated_at=2 WHERE id='ep065'");
    assert.equal((await queries.listUserActivityPage("author")).total, 64);
    const notices = await queries.listNotificationsPage("reader", { page: 4 });
    assert.equal(notices.total, 65);
    assert.equal(notices.items.length, 5);
    db.exec("UPDATE notifications SET read_at=2 WHERE id >= 'np021'");
    const unread = await queries.listNotificationsPage("reader", { page: 4, unreadOnly: true });
    assert.equal(unread.total, 20);
    assert.equal(unread.page, 1);
    assert.equal((await queries.listNotificationsPage("author")).total, 0);
    assert.ok(maxColumns <= 100, `D1 projection cap exceeded: ${maxColumns}`);
  } finally {
    db.close();
  }
});
