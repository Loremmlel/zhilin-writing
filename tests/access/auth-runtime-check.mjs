import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const fs = require("fs");
const path = fileURLToPath(new URL("../../", import.meta.url));
const req = require;
const ts = req("typescript");
const assert = require("assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { drizzle } = req("drizzle-orm/sqlite-proxy");
function load(file, deps) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path + file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", code)(
    exports,
    (name) => deps[name] ?? (name.startsWith(".") || name.startsWith("@/") ? {} : req(name)),
  );
  return exports;
}
export default async function checkAuthRuntime() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of fs
    .readdirSync(path + "drizzle")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    sqlite.exec(fs.readFileSync(path + "drizzle/" + file, "utf8"));
  }
  const statements = [];

  let writes = 0;
  const execute = (sql, params, method) => {
    statements.push(sql);
    const stmt = sqlite.prepare(sql);
    if (method === "run") {
      writes++;
      stmt.run(...params);
      return { rows: [] };
    }
    stmt.setReturnArrays(true);
    return { rows: stmt.all(...params) };
  };
  const db = drizzle(
    async (...args) => execute(...args),
    async (queries) => queries.map((q) => execute(q.sql, q.params, q.method)),
  );
  const schema = load("db/schema.ts", {});
  const visibility = await import(path + "lib/posts/visibility.ts");
  const queries = load("db/queries.ts", {
    "@/lib/posts/visibility": visibility,
    "./index": { getDb: () => db },
    "./schema": schema,
    "vinext/cache": await import(path + "node_modules/vinext/dist/cache.js"),
    "@/lib/lifecycle/views": await import(path + "lib/lifecycle/views.ts"),
    "@/lib/lifecycle/policy": await import(path + "lib/lifecycle/policy.ts"),
    "@/lib/pagination": await import(path + "lib/pagination.ts"),
  });
  await queries.ensureConfiguredAdministrator("owner@example.com");
  assert.equal(writes, 3);
  writes = 0;
  await queries.ensureConfiguredAdministrator("owner@example.com");
  assert.equal(writes, 0);
  sqlite.exec(
    "INSERT INTO allowed_users VALUES ('member','member@example.com',0,0,'owner'); INSERT INTO allowed_users VALUES ('legacy','legacy@example.com',1,0,NULL)",
  );
  await queries.ensureConfiguredAdministrator("new@example.com");
  assert.equal(writes, 3);
  assert.deepEqual(
    sqlite
      .prepare("SELECT email,is_admin FROM allowed_users ORDER BY email")
      .all()
      .map((r) => ({ ...r })),
    [
      { email: "member@example.com", is_admin: 0 },
      { email: "new@example.com", is_admin: 1 },
    ],
  );
  const { cacheForRequest } = await import(path + "node_modules/vinext/dist/cache.js");
  const { createRequestContext, runWithRequestContext } = await import(
    path + "node_modules/vinext/dist/shims/unified-request-context.js"
  );
  const { AsyncLocalStorage } = require("node:async_hooks");
  const identity = new AsyncLocalStorage();
  let reads = 0;
  const auth = load("lib/auth/access.ts", {
    "vinext/cache": { cacheForRequest },
    "cloudflare:workers": { env: {} },
    "next/navigation": {
      redirect: (url) => {
        throw Error(url);
      },
    },
    "@/app/chatgpt-auth": {
      getChatGPTUser: async () => identity.getStore(),
      chatGPTSignInPath: (p) => "/signin?return=" + p,
    },
    "@/db/queries": {
      findAllowedMember: async (email) => {
        reads++;
        return email === "revoked"
          ? null
          : { allowed: { email, isAdmin: false }, member: email === "new" ? null : { id: email } };
      },
    },
    "@/lib/domain/rules": await import(path + "lib/domain/rules.ts"),
  });
  await Promise.all(
    ["a", "b"].map((email) =>
      identity.run({ email }, () =>
        runWithRequestContext(createRequestContext(), async () => {
          const [a, b] = await Promise.all([
            auth.requireMember("/"),
            auth.requireMember("/posts/x"),
          ]);
          assert.equal(a.member.id, email);
          assert.equal(b.member.id, email);
        }),
      ),
    ),
  );
  assert.equal(reads, 2);
  await identity.run({ email: "revoked" }, () =>
    runWithRequestContext(createRequestContext(), async () => {
      await assert.rejects(auth.requireMember("/"), /access-denied/);
    }),
  );
  assert.equal(reads, 3);

  sqlite.exec(
    "INSERT INTO users(id,email_key,display_name,joined_at,updated_at) VALUES('author','author@example.test','Author',0,0),('reader','reader@example.test','Reader',0,0)",
  );
  sqlite.exec(
    "INSERT INTO posts(id,author_id,title,markdown,published_at,last_activity_at) VALUES('post','author','Title','Body',0,0)",
  );
  await runWithRequestContext(createRequestContext(), async () => {
    const start = statements.length;
    const [detail, row] = await Promise.all([
      queries.getPostDetail("post", "reader"),
      queries.getPostReadRow("post", "reader"),
    ]);
    assert.equal(detail.markdown, "Body");
    assert.equal(row.post.id, "post");
    assert.equal(statements.slice(start).filter((sql) => sql.includes('from "posts"')).length, 1);
  });
  sqlite.exec("UPDATE posts SET deleted_at=1 WHERE id='post'");
  sqlite.exec(
    "INSERT INTO replies(id,post_id,author_id,markdown,published_at,submission_key) VALUES('reply','post','reader','Discussion',0,'reply')",
  );
  await runWithRequestContext(createRequestContext(), async () => {
    const detail = await queries.getPostDetail("post", "reader");
    assert.equal(detail.markdown, null);
    assert.equal(detail.lifecycle.hasOtherMemberDiscussion, true);
    assert.equal(detail.lifecycle.discussionReachable, true);
    assert.deepEqual(detail.tags, []);
    assert.deepEqual(detail.attachments, []);
  });
  sqlite.exec("UPDATE posts SET deleted_at=NULL, search_text='摘要' WHERE id='post'");
  const longText = "😀".repeat(150) + " 下一段".repeat(500);
  sqlite
    .prepare("UPDATE posts SET search_text=?,markdown=? WHERE id='post'")
    .run(longText, "正文".repeat(10000));
  const { excerpt } = await import(path + "lib/format.ts");
  const page = await queries.listPostsPage("reader");
  assert.equal(excerpt(page.items[0].post.searchText), excerpt(longText));
  assert.equal(page.items[0].post.markdown, "");
  assert.ok(Array.from(page.items[0].post.searchText).length <= 152);
  sqlite.exec(
    "INSERT INTO tags(id,name,normalized_name,created_at) VALUES('tag','Tag','tag',0); INSERT INTO post_tags(post_id,tag_id) VALUES('post','tag')",
  );
  assert.equal((await queries.listPostsPage("reader", { tagName: "TAG" })).total, 1);
  assert.equal((await queries.listPostsPage("reader", { tagName: "missing" })).total, 0);
  assert.equal((await queries.listPostsPage("reader", { page: 999 })).page, 1);
  assert.equal((await queries.countAdminOverviewByStatus())[0].normal, 1);
  sqlite.exec("UPDATE replies SET reply_to_user_id='author' WHERE id='reply'");
  const replyRows = await queries.listReplies("post", "reader");
  assert.equal(replyRows[0].replyTo.displayName, "Author");
  assert.equal((await queries.getVisiblePostRecord("post")).id, "post");
  sqlite.exec("UPDATE posts SET hidden_at=1 WHERE id='post'");
  assert.equal(await queries.getVisiblePostRecord("post"), null);

  const accessService = load("lib/assets/access-service.ts", {
    "@/lib/posts/visibility": visibility,
    "@/db": { getDb: () => db },
    "@/db/schema": schema,
    "./access": await import(path + "lib/assets/access.ts"),
  });
  sqlite.exec(
    "INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES('asset','author','key','image','file','image/png',1,'permanent',0)",
  );
  assert.equal(
    await accessService.canReadAsset("asset", { userId: "author", isAdmin: false }),
    false,
  );
  sqlite.exec(
    "INSERT INTO post_asset_refs(post_id,asset_id,usage) VALUES('post','asset','attachment')",
  );
  assert.equal(
    await accessService.canReadAsset("asset", { userId: "reader", isAdmin: false }),
    false,
  );
  assert.equal(
    await accessService.canReadAsset("asset", { userId: "reader", isAdmin: true }),
    true,
  );
  sqlite.exec("UPDATE posts SET hidden_at=NULL WHERE id='post'");
  assert.equal(
    await accessService.canReadAsset("asset", { userId: "reader", isAdmin: false }),
    true,
  );
  sqlite.exec("UPDATE assets SET status='temporary' WHERE id='asset'");
  assert.equal(
    await accessService.canReadAsset("asset", { userId: "reader", isAdmin: false }),
    false,
  );
  assert.equal(
    await accessService.canReadAsset("asset", { userId: "author", isAdmin: false }),
    true,
  );
  assert.equal(await accessService.getAssetAccessFacts("missing", "reader"), null);
  assert.equal(await queries.findAllowedMember("absent@example.test", null), null);
  await queries.addAllowedUser("author@example.test", false, "owner");
  const joinedStart = statements.length;
  const accessRow = await queries.findAllowedMember("author@example.test", null);
  assert.equal(accessRow.member.id, "author");
  assert.equal(statements.length - joinedStart, 1);
  await queries.findAllowedMember("author@example.test", "author@example.test");
  const ownerStart = statements.length;
  const ownerRow = await queries.findAllowedMember("author@example.test", "author@example.test");
  assert.equal(ownerRow.allowed.isAdmin, true);
  assert.equal(statements.length - ownerStart, 1);
  assert.equal(await queries.findAllowedMember("new@example.com", null), null);
  assert.deepEqual(await identity.run(null, () => auth.getApiMemberAccess()), {
    ok: false,
    code: "AUTH_EXPIRED",
    status: 401,
  });
  assert.deepEqual(await identity.run({ email: "revoked" }, () => auth.getApiMemberAccess()), {
    ok: false,
    code: "ACCESS_REVOKED",
    status: 403,
  });
  assert.deepEqual(await identity.run({ email: "new" }, () => auth.getApiMemberAccess()), {
    ok: false,
    code: "ONBOARDING_REQUIRED",
    status: 403,
  });
  const annotationQueries = load("lib/annotations/queries.ts", {
    "@/db": { getDb: () => db },
    "@/db/schema": schema,
  });
  const annotationService = load("lib/annotations/service.ts", {
    "@/lib/posts/visibility": visibility,
    "@/db": { getDb: () => db },
    "@/db/schema": schema,
    "./queries": annotationQueries,
    "./policy": await import(path + "lib/annotations/policy.ts"),
    "./transaction": await import(path + "lib/annotations/transaction.ts"),
    "@/lib/activity/policy": await import(path + "lib/activity/policy.ts"),
  });
  sqlite.exec(
    "INSERT INTO post_revisions(id,post_id,revision_number,title,markdown,created_at,created_by_user_id) VALUES('revision','post',1,'Title','Body',0,'author'); UPDATE posts SET current_revision_id='revision' WHERE id='post'",
  );
  const annotationId = "ann_" + crypto.randomUUID();
  sqlite
    .prepare(
      "INSERT INTO annotations(id,post_id,author_id,content_markdown,original_selected_text,created_at,created_on_revision_id,submission_key) VALUES(?,'post','author','Comment','Body',0,'revision','seed')",
    )
    .run(annotationId);
  sqlite
    .prepare("INSERT INTO post_annotation_anchors(post_id,annotation_id) VALUES('post',?)")
    .run(annotationId);
  const replyInput = {
    postId: "post",
    annotationId,
    authorId: "reader",
    contentMarkdown: "Reply",
    submissionKey: crypto.randomUUID(),
  };
  const replyId = await annotationService.createAnnotationReply(replyInput);
  assert.equal(await annotationService.createAnnotationReply(replyInput), replyId);
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM annotation_replies WHERE id=?").get(replyId).n,
    1,
  );
  assert.equal(
    sqlite
      .prepare("SELECT recipient_user_id FROM notifications WHERE annotation_reply_id=?")
      .get(replyId).recipient_user_id,
    "author",
  );
  sqlite.prepare("UPDATE annotations SET hidden_at=1 WHERE id=?").run(annotationId);
  await assert.rejects(
    annotationService.createAnnotationReply({ ...replyInput, submissionKey: crypto.randomUUID() }),
    /不可回复/,
  );
  sqlite.close();
}
