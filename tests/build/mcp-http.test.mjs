import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

test("built MCP route serves discovery, OAuth identity, scoped reads and R2 image blocks", async () => {
  const root = fileURLToPath(new URL("../../dist/server/", import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter(
    (file) => file.endsWith(".js") && file !== "index.js",
  );
  const mf = new Miniflare({
    modulesRoot: root,
    modules: ["index.js", ...files].map((file) => ({ type: "ESModule", path: join(root, file) })),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    assets: {
      directory: fileURLToPath(new URL("../../dist/client/", import.meta.url)),
      binding: "ASSETS",
      routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
    },
  });
  try {
    const db = await mf.getD1Database("DB");
    for (const file of (await readdir(new URL("../../drizzle/", import.meta.url)))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()) {
      const statements = (await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8"))
        .split("--> statement-breakpoint")
        .map((part) => part.trim())
        .filter(Boolean);
      await db.batch(statements.map((part) => db.prepare(part)));
    }
    await db.batch([
      db.prepare(
        "INSERT INTO users(id,email_key,display_name,joined_at,updated_at) VALUES ('reader','reader@example.test','Reader',1,1)",
      ),
      db.prepare(
        "INSERT INTO allowed_users(id,email,is_admin,permission_group,added_at,added_by_user_id) VALUES ('reader','reader@example.test',0,'normal',1,'owner')",
      ),
      db.prepare(
        "INSERT INTO posts(id,author_id,title,markdown,search_text,published_at,last_activity_at) VALUES ('post','reader','随笔','正文','正文',1,1)",
      ),
      db.prepare(
        "INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES ('image','reader','object-key','image','image.png','image/png',3,'permanent',1)",
      ),
      db.prepare(
        "INSERT INTO post_asset_refs(post_id,asset_id,usage) VALUES ('post','image','inline')",
      ),
    ]);
    await (await mf.getR2Bucket("BUCKET")).put("object-key", new Uint8Array([1, 2, 3]));
    const rpc = async (method, params, authenticated = true, version = "2025-06-18") => {
      const response = await mf.dispatchFetch("https://site.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": version,
          ...(authenticated
            ? {
                "oai-authenticated-user-email": "reader@example.test",
                "oai-authenticated-user-id": "site-reader",
              }
            : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return { response, body: JSON.parse(await response.text()) };
    };
    const discovery = await rpc("tools/list", {}, false);
    assert.equal(discovery.response.status, 200);
    assert.equal(discovery.body.result.tools.length, 9);
    assert.equal(discovery.response.headers.get("cache-control"), "private, no-store");
    const negotiation = await rpc(
      "initialize",
      {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "ChatGPT", version: "1" },
      },
      false,
      "2026-07-28",
    );
    assert.equal(negotiation.response.status, 200);
    assert.equal(negotiation.body.result.protocolVersion, "2025-11-25");
    const modern = (method, params = {}, authenticated = true) =>
      rpc(
        method,
        {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
        authenticated,
        "2026-07-28",
      );
    const modernDiscovery = await modern("server/discover", {}, false);
    assert.equal(modernDiscovery.response.status, 200);
    assert.equal(modernDiscovery.body.result.resultType, "complete");
    assert.equal(modernDiscovery.body.result.supportedVersions[0], "2026-07-28");
    const modernTools = await modern("tools/list", {}, false);
    assert.equal(modernTools.body.result.tools.length, 9);
    assert.equal(modernTools.body.result.ttlMs, 0);
    const modernPosts = await modern("tools/call", { name: "list_posts" });
    assert.equal(modernPosts.body.result.resultType, "complete");
    assert.equal(modernPosts.body.result.structuredContent.items[0].id, "post");
    assert.equal((await modern("tools/call", { name: "list_posts" }, false)).response.status, 401);
    const call = (name, args = {}, authenticated = true) =>
      rpc("tools/call", { name, arguments: args }, authenticated);
    assert.equal((await call("list_posts", {}, false)).response.status, 401);
    assert.equal((await call("get_access_info")).body.result.structuredContent.user.id, "reader");
    assert.equal((await call("list_posts")).body.result.structuredContent.items[0].id, "post");
    assert.equal(
      (await call("get_post_content", { postId: "post" })).body.result.structuredContent.markdown,
      "正文",
    );
    assert.equal(
      (await call("get_image", { postId: "post", assetId: "image" })).body.result.content[1].data,
      "AQID",
    );
    await db.prepare("UPDATE posts SET visibility_user_ids='[]' WHERE id='post'").run();
    assert.equal((await call("get_post_content", { postId: "post" })).body.result.isError, true);
    assert.equal(
      (await call("get_image", { postId: "post", assetId: "image" })).body.result.isError,
      true,
    );
    await db.prepare("UPDATE allowed_users SET permission_group='game' WHERE id='reader'").run();
    assert.equal((await call("list_posts")).response.status, 403);
  } finally {
    await mf.dispose();
  }
});
