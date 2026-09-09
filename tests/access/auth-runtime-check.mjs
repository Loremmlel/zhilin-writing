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
  const queries = load("db/queries.ts", {
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
      findAllowedUser: async (email) => {
        reads++;
        return email === "revoked" ? null : { email, isAdmin: false };
      },
      findUserByEmail: async (email) => ({ id: email }),
      ensureConfiguredAdministrator: () => {
        throw Error("unexpected bootstrap");
      },
    },
    "@/lib/auth/authorize": await import(path + "lib/auth/authorize.ts"),
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
      queries.getPostDetail("post"),
      queries.getPostReadRow("post"),
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
    const detail = await queries.getPostDetail("post");
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
  const page = await queries.listPostsPage();
  assert.equal(excerpt(page.items[0].post.searchText), excerpt(longText));
  assert.equal(page.items[0].post.markdown, "");
  assert.ok(Array.from(page.items[0].post.searchText).length <= 152);
  sqlite.exec(
    "INSERT INTO tags(id,name,normalized_name,created_at) VALUES('tag','Tag','tag',0); INSERT INTO post_tags(post_id,tag_id) VALUES('post','tag')",
  );
  assert.equal((await queries.listPostsPage({ tagName: "TAG" })).total, 1);
  assert.equal((await queries.listPostsPage({ tagName: "missing" })).total, 0);
  assert.equal((await queries.listPostsPage({ page: 999 })).page, 1);
  assert.equal((await queries.countAdminOverviewByStatus())[0].normal, 1);
  sqlite.exec("UPDATE replies SET reply_to_user_id='author' WHERE id='reply'");
  const replyRows = await queries.listReplies("post");
  assert.equal(replyRows[0].replyTo.displayName, "Author");
  assert.equal((await queries.getVisiblePostRecord("post")).id, "post");
  sqlite.exec("UPDATE posts SET hidden_at=1 WHERE id='post'");
  assert.equal(await queries.getVisiblePostRecord("post"), null);

  const accessService = load("lib/assets/access-service.ts", {
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
  assert.equal(await accessService.getAssetAccessFacts("missing"), null);
  sqlite.close();
}
