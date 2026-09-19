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
    if (
      specifier === "@/db" ||
      (specifier === "./index" && context.parentURL?.endsWith("/db/queries.ts"))
    )
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
const visibility = await import("../../lib/posts/visibility-service.ts");
const assets = await import("../../lib/assets/access-service.ts");
const { parsePostVisibilityField } = await import("../../lib/posts/visibility.ts");
const postService = await import("../../lib/posts/service.ts");
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
  const execute = async (sql: string, params: unknown[], method: string) => {
    calls++;
    const statement = db.prepare(sql);
    maxColumns = Math.max(maxColumns, statement.columns().length);
    if (method === "run") {
      statement.run(...(params as []));
      return { rows: [] };
    }
    statement.setReturnArrays(true);
    return { rows: statement.all(...(params as [])) as unknown as unknown[][] };
  };
  useQueryDatabase(
    drizzle(execute, async (queries) => {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const q of queries) results.push(await execute(q.sql, q.params, q.method));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
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
      const result = await queries.listPostsPage("reader", { page, tagName: "校园" });
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
      (await queries.listPostsPage("reader", { sort: "active", page: 2 })).items[0].post.id,
      "p045",
    );
    assert.equal((await queries.listPostsPage("reader", { query: "未匹配", page: 90 })).page, 1);
    assert.equal((await queries.listPostsPage("reader", { tagName: "不存在" })).total, 0);
    assert.equal((await queries.listPostsPage("reader", { authorId: "reader" })).total, 0);
    calls = 0;
    await queries.listPostsPage("reader");
    assert.equal(calls, 5, "count, page, batched tags, reply counts and annotation counts only");
    db.exec("UPDATE posts SET hidden_at=2 WHERE id >= 'p041'");
    const clamped = await queries.listPostsPage("reader", { page: 4 });
    assert.equal(clamped.total, 40);
    assert.equal(clamped.page, 2);
    assert.equal(clamped.items.length, 20);
    db.exec("UPDATE posts SET deleted_at=2 WHERE id='p040'");
    assert.equal((await queries.listPostsPage("reader", { tagName: "校园" })).total, 39);
    const activity = await queries.listUserActivityPage("author", "reader", 4);
    assert.equal(activity.total, 65);
    assert.equal(activity.items.length, 5);
    const hiddenActivity = await queries.listUserActivityPage("author", "reader", 1);
    assert.equal(hiddenActivity.items[0].post?.title, "");
    db.exec("UPDATE activity_events SET invalidated_at=2 WHERE id='ep065'");
    assert.equal((await queries.listUserActivityPage("author", "reader")).total, 64);
    const notices = await queries.listNotificationsPage("reader", { page: 4 });
    assert.equal(notices.total, 65);
    assert.equal(notices.items.length, 5);
    db.exec("UPDATE notifications SET read_at=2 WHERE id >= 'np021'");
    const unread = await queries.listNotificationsPage("reader", { page: 4, unreadOnly: true });
    assert.equal(unread.total, 20);
    assert.equal(unread.page, 1);
    assert.equal((await queries.listNotificationsPage("author")).total, 0);
    // A scope change immediately hides every public projection, even historical notifications.
    db.exec(
      "UPDATE posts SET hidden_at=NULL, deleted_at=NULL; UPDATE activity_events SET invalidated_at=NULL; UPDATE notifications SET read_at=NULL",
    );
    db.exec(
      "INSERT INTO users(id,email_key,display_name,bio,joined_at,updated_at) VALUES ('admin','admin@example.test','管理员','',1,1)",
    );
    db.exec(
      "INSERT INTO allowed_users(id,email,is_admin,added_at) VALUES ('aa','author@example.test',0,1),('ar','reader@example.test',0,1),('admin','admin@example.test',1,1)",
    );
    assert.deepEqual((await visibility.listPostVisibilityUsers()).map((user) => user.id).sort(), [
      "author",
      "reader",
    ]);
    assert.deepEqual(await visibility.normalizePostVisibility([], "author"), ["author"]);
    await assert.rejects(visibility.normalizePostVisibility(["admin"], "author"));
    await assert.rejects(visibility.normalizePostVisibility(["unknown"], "author"));
    assert.throws(() => parsePostVisibilityField('"public"'));
    assert.equal(parsePostVisibilityField(null), undefined);
    const scope = await visibility.normalizePostVisibility([], "author");
    db.prepare("UPDATE posts SET visibility_user_ids=?").run(JSON.stringify(scope));
    assert.equal((await queries.listPostsPage("reader", { query: "文章", page: 4 })).total, 0);
    assert.equal((await queries.listPostsPage("reader", { tagName: "校园" })).total, 0);
    assert.equal((await queries.listPostsPage("reader", { authorId: "author" })).total, 0);
    assert.equal((await queries.listPostsPage("author")).total, 65);
    assert.equal((await queries.listPostsPage("admin")).total, 65);
    assert.equal(await queries.getPost("p065", "reader"), null);
    assert.equal((await queries.getPost("p065", "admin"))?.post.id, "p065");
    assert.equal((await queries.listTags("reader")).length, 0);
    assert.equal((await queries.listTags("admin"))[0].postCount, 65);
    assert.equal((await queries.listUserActivityPage("author", "reader")).total, 0);
    assert.equal((await queries.listUserActivityPage("author", "admin")).total, 65);
    assert.equal((await queries.listNotificationsPage("reader")).total, 0);
    assert.equal(await queries.countUnreadNotifications("reader"), 0);
    assert.equal(await queries.findOwnedNotification("np065", "reader"), null);
    assert.equal(await visibility.canViewPost("p065", "reader"), false);
    assert.equal(await visibility.canViewPost("p065", "admin"), true);
    db.exec(
      "INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES ('private-image','author','private-image','image','image.png','image/png',1,'permanent',1)",
    );
    db.exec(
      "INSERT INTO post_asset_refs(post_id,asset_id,usage) VALUES ('p065','private-image','inline')",
    );
    assert.equal(
      await assets.canReadAsset("private-image", { userId: "reader", isAdmin: false }),
      false,
    );
    assert.equal(
      await assets.canReadAsset("private-image", { userId: "admin", isAdmin: true }),
      true,
    );
    db.prepare("UPDATE posts SET visibility_user_ids=? WHERE id='p065'").run(
      JSON.stringify(["author", "reader"]),
    );
    assert.equal((await queries.listPostsPage("reader", { page: 4 })).total, 1);
    assert.equal((await queries.listPostsPage("reader", { page: 4 })).page, 1);
    assert.equal(
      await assets.canReadAsset("private-image", { userId: "reader", isAdmin: false }),
      true,
    );
    assert.equal(await queries.countUnreadNotifications("reader"), 1);
    assert.ok(await queries.findOwnedNotification("np065", "reader"));
    db.exec("UPDATE posts SET visibility_user_ids=NULL");
    assert.equal((await queries.listPostsPage("reader")).total, 65);
    const postId = await postService.createPost("author", {
      title: "指定读者",
      markdown: "正文",
      tags: [],
      visibilityUserIds: ["reader"],
      submissionKey: crypto.randomUUID(),
    });
    const created = await queries.getPost(postId, "reader");
    assert.deepEqual(created?.post.visibilityUserIds, ["author", "reader"]);
    const originalRevision = created!.post.currentRevisionId!;
    const saved = await postService.updatePost(postId, "author", {
      title: "指定读者",
      markdown: "正文",
      tags: [],
      visibilityUserIds: [],
      baseRevisionId: originalRevision,
    });
    assert.equal(
      saved.revisionCreated,
      true,
      "permission-only updates participate in conflict protection",
    );
    assert.equal(await queries.getPost(postId, "reader"), null);
    await assert.rejects(
      postService.createReply({
        postId,
        authorId: "reader",
        markdown: "禁止回复",
        submissionKey: crypto.randomUUID(),
      }),
    );
    await assert.rejects(
      postService.updatePost(postId, "author", {
        title: "旧窗口",
        markdown: "正文",
        tags: [],
        visibilityUserIds: null,
        baseRevisionId: originalRevision,
      }),
      /其他设备或窗口/,
    );
    assert.deepEqual((await queries.getPost(postId, "author"))?.post.visibilityUserIds, ["author"]);
    await postService.updatePost(postId, "author", {
      title: "指定读者",
      markdown: "修改正文",
      tags: [],
      baseRevisionId: saved.currentRevisionId,
    });
    assert.deepEqual(
      (await queries.getPost(postId, "author"))?.post.visibilityUserIds,
      ["author"],
      "older clients cannot reset a private scope by omitting it",
    );
    assert.ok(maxColumns <= 100, `D1 projection cap exceeded: ${maxColumns}`);
  } finally {
    db.close();
  }
});
