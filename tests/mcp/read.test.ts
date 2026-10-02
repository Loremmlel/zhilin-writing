import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { useQueryDatabase } from "../helpers/query-database.ts";

const imageBytes = Buffer.from("test-image");
let imageReads = 0;
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
    if (specifier === "@/lib/assets/storage")
      return {
        url: "data:text/javascript,export async function getStoredObject(key) { return globalThis.__mcpImage(key); }",
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
const { handleMcpRequest, mcpTools } = await import("../../lib/mcp/protocol.ts");
const { callMcpTool, getMcpWritingAccess } = await import("../../lib/mcp/service.ts");
hooks.deregister();

test("MCP read tools enforce fresh identity, content scope and lifecycle using production D1 queries", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of (await readdir(new URL("../../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort())
    sqlite.exec(await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO users(id,email_key,display_name,joined_at,updated_at) VALUES
      ('owner','owner@example.com','Owner',1,1),('reader','reader@example.com','Reader',1,1),('game','game@example.com','Game',1,1);
    INSERT INTO allowed_users(id,email,is_admin,permission_group,added_at,added_by_user_id) VALUES
      ('owner','owner@example.com',1,'normal',1,'owner'),('reader','reader@example.com',0,'normal',1,'owner'),('game','game@example.com',0,'game',1,'owner'),('new','new@example.com',0,'normal',1,'owner');
    INSERT INTO posts(id,author_id,title,markdown,search_text,published_at,last_activity_at,visibility_user_ids,current_revision_id) VALUES
      ('public','owner','公开随笔','正文😀abcdef','正文关键词',1,1,NULL,'revision'),('private','owner','私密随笔','SECRET_BODY','SECRET_KEYWORD',1,1,'["owner"]','private-revision');
    INSERT INTO post_revisions(id,post_id,revision_number,title,markdown,created_at,created_by_user_id) VALUES
      ('revision','public',1,'公开随笔','正文😀abcdef',1,'owner'),('private-revision','private',1,'私密随笔','SECRET_BODY',1,'owner');
    INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES
      ('public-image','owner','PUBLIC_STORAGE_KEY','image','photo.png','image/png',10,'permanent',1),('private-image','owner','SECRET_STORAGE_KEY','image','secret.png','image/png',10,'permanent',1);
    INSERT INTO post_asset_refs(post_id,asset_id,usage) VALUES ('public','public-image','inline'),('private','private-image','inline');
    INSERT INTO replies(id,post_id,author_id,markdown,published_at) VALUES ('comment','public','reader','评论内容',1),('hidden-comment','public','owner','HIDDEN_COMMENT',2);
    UPDATE replies SET hidden_at=2 WHERE id='hidden-comment';
  `);
  const annotationId = `ann_${crypto.randomUUID()}`;
  sqlite
    .prepare("UPDATE posts SET markdown=? WHERE id='public'")
    .run(`:annotation[正文😀]{#${annotationId}}\n\nabcdef`);
  sqlite
    .prepare(
      "INSERT INTO annotations(id,post_id,author_id,content_markdown,original_selected_text,created_at,created_on_revision_id,submission_key) VALUES (?,'public','owner','批注内容','正文😀',1,'revision','annotation-key')",
    )
    .run(annotationId);
  sqlite.prepare("INSERT INTO post_annotation_anchors VALUES ('public',?)").run(annotationId);
  sqlite
    .prepare(
      "INSERT INTO annotation_replies(id,annotation_id,author_id,content_markdown,submission_key,created_at) VALUES ('annotation-reply',?,'reader','批注回复','reply-key',1)",
    )
    .run(annotationId);
  const prepare = (query: string, params: unknown[] = []) => {
    const execute = (raw = false, batch = false) => {
      assert.match(query, /^select /i, "MCP must never write business data");
      assert.ok(params.length <= 100, "D1 parameter limit");
      const statement = sqlite.prepare(query);
      const columns = statement.columns().map((column) => column.name);
      assert.ok(columns.length <= 100, "D1 column limit");
      if (batch)
        assert.equal(new Set(columns).size, columns.length, "batch aliases must be unique");
      statement.setReturnArrays(raw);
      return statement.all(...(params as []));
    };
    return {
      bind: (...values: unknown[]) => prepare(query, values),
      raw: async () => execute(true),
      all: async () => ({ results: execute(), success: true }),
      batchResult: () => ({ results: execute(false, true), success: true }),
    };
  };
  useQueryDatabase(
    drizzle({
      prepare,
      batch: async (items: ReturnType<typeof prepare>[]) => items.map((item) => item.batchResult()),
    } as unknown as D1Database),
  );
  (globalThis as typeof globalThis & { __mcpImage: (key: string) => unknown }).__mcpImage = (
    key,
  ) => {
    imageReads++;
    assert.equal(key, "PUBLIC_STORAGE_KEY");
    return { size: imageBytes.length, arrayBuffer: async () => imageBytes };
  };
  let logged = 0;
  const request = async (
    method: string,
    params?: unknown,
    email?: string,
    options: {
      id?: string | number | null;
      headers?: Record<string, string>;
      raw?: string;
      verb?: string;
    } = {},
  ) => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(email
        ? { "oai-authenticated-user-email": email, "oai-authenticated-user-id": "site-user" }
        : {}),
      ...options.headers,
    };
    const response = await handleMcpRequest(
      new Request("https://example.com/mcp", {
        method: options.verb ?? "POST",
        headers,
        body:
          options.verb === "GET"
            ? undefined
            : (options.raw ??
              JSON.stringify({
                jsonrpc: "2.0",
                ...(options.id === null ? {} : { id: options.id ?? 1 }),
                method,
                params,
              })),
      }),
      {
        access: getMcpWritingAccess,
        call: callMcpTool,
        report: () => {
          logged++;
          return "incident";
        },
      },
    );
    return {
      response,
      body:
        response.status === 202 || response.status === 405
          ? null
          : JSON.parse(await response.text()),
    };
  };
  const call = (name: string, args: Record<string, unknown> = {}, email = "reader@example.com") =>
    request("tools/call", { name, arguments: args }, email);
  try {
    const discovery = await request("tools/list");
    assert.equal(discovery.body.result.tools.length, 9);
    assert.ok(
      discovery.body.result.tools.every(
        (tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint,
      ),
    );
    assert.ok(!JSON.stringify(discovery.body).includes("SECRET"));
    assert.equal(
      (
        await request("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        })
      ).body.result.protocolVersion,
      "2025-06-18",
    );
    const modernHeaders = { "mcp-protocol-version": "2026-07-28" };
    const modernMeta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const negotiated = await request(
      "initialize",
      {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "ChatGPT", version: "1" },
      },
      undefined,
      { headers: modernHeaders },
    );
    assert.equal(negotiated.response.status, 200);
    assert.equal(negotiated.body.result.protocolVersion, "2025-11-25");
    assert.equal(negotiated.body.result.resultType, undefined);
    const modernRequest = (method: string, params: Record<string, unknown> = {}, email?: string) =>
      request(method, { ...params, _meta: modernMeta }, email, { headers: modernHeaders });
    const serverDiscovery = await modernRequest("server/discover");
    assert.equal(serverDiscovery.response.status, 200);
    assert.equal(serverDiscovery.body.result.resultType, "complete");
    assert.equal(serverDiscovery.body.result.supportedVersions[0], "2026-07-28");
    assert.equal(serverDiscovery.body.result.ttlMs, 0);
    assert.equal(serverDiscovery.body.result.cacheScope, "public");
    const modernTools = await modernRequest("tools/list");
    assert.equal(modernTools.body.result.tools.length, 9);
    assert.equal(modernTools.body.result.resultType, "complete");
    assert.equal(modernTools.body.result.ttlMs, 0);
    const modernPosts = await modernRequest(
      "tools/call",
      { name: "list_posts" },
      "reader@example.com",
    );
    assert.equal(modernPosts.body.result.resultType, "complete");
    assert.deepEqual(
      modernPosts.body.result.structuredContent.items.map((post: { id: string }) => post.id),
      ["public"],
    );
    assert.equal((await modernRequest("tools/call", { name: "list_posts" })).response.status, 401);
    assert.equal(
      (await modernRequest("tools/call", { name: "list_posts" }, "game@example.com")).response
        .status,
      403,
    );
    assert.equal(
      (await request("tools/list", {}, undefined, { headers: modernHeaders })).body.error.code,
      -32602,
    );
    assert.equal(
      (
        await request("tools/list", { _meta: modernMeta }, undefined, {
          headers: { "mcp-protocol-version": "2025-06-18" },
        })
      ).body.error.code,
      -32020,
    );
    for (const headers of [{ "mcp-method": "ping" }, { "mcp-name": "wrong_tool" }] as Record<
      string,
      string
    >[]) {
      assert.equal(
        (
          await request(
            "tools/call",
            { name: "list_posts", _meta: modernMeta },
            "reader@example.com",
            { headers: { ...modernHeaders, ...headers } },
          )
        ).body.error.code,
        -32020,
      );
    }
    assert.equal((await modernRequest("unknown/method")).response.status, 404);
    const unsupported = await request("tools/list", {}, undefined, {
      headers: { "mcp-protocol-version": "2099-01-01" },
    });
    assert.equal(unsupported.response.status, 400);
    assert.equal(unsupported.body.error.code, -32022);
    assert.equal(unsupported.body.error.data.requested, "2099-01-01");
    assert.equal(
      (await request("notifications/initialized", {}, undefined, { id: null })).response.status,
      202,
    );
    assert.equal(
      (await request("tools/list", {}, undefined, { verb: "GET" })).response.status,
      405,
    );
    assert.equal(
      (await request("tools/list", {}, undefined, { raw: "[{}]" })).response.status,
      400,
    );
    assert.equal(
      (await request("tools/list", {}, undefined, { raw: "{" })).body.error.code,
      -32700,
    );
    assert.equal(
      (await request("tools/list", {}, undefined, { raw: " ".repeat(65 * 1024) })).response.status,
      413,
    );
    assert.equal(
      (await request("tools/list", {}, undefined, { headers: { origin: "https://evil.example" } }))
        .response.status,
      403,
    );
    assert.equal(
      (
        await request("tools/list", {}, undefined, {
          headers: { "mcp-protocol-version": "unsupported" },
        })
      ).response.status,
      400,
    );
    assert.equal((await request("tools/call", { name: "list_posts" })).response.status, 401);
    assert.equal(
      (
        await request("tools/call", { name: "list_posts" }, undefined, {
          headers: { cookie: "zhilin-session=pretend-owner" },
        })
      ).response.status,
      401,
    );
    assert.equal(
      (
        await request("tools/call", { name: "list_posts" }, undefined, {
          headers: { "oai-authenticated-user-email": "owner@example.com" },
        })
      ).response.status,
      401,
    );
    assert.equal((await call("list_posts", {}, "absent@example.com")).response.status, 403);
    assert.equal((await call("list_posts", {}, "new@example.com")).response.status, 403);
    for (const tool of mcpTools) {
      const args = tool.schema.parse({
        ...(tool.name === "search_posts" ? { query: "正文" } : {}),
        ...([
          "get_post_content",
          "list_post_images",
          "get_image",
          "list_annotations",
          "list_annotation_replies",
          "list_comments",
        ].includes(tool.name)
          ? { postId: "public" }
          : {}),
        ...(tool.name === "get_image" ? { assetId: "public-image" } : {}),
        ...(tool.name === "list_annotation_replies" ? { annotationId } : {}),
      });
      assert.equal(
        (await call(tool.name, args, "game@example.com")).response.status,
        403,
        tool.name,
      );
    }
    assert.equal((await call("list_posts", { viewerId: "owner" })).body.error.code, -32602);
    assert.equal(
      (await call("get_access_info", {}, " Reader@Example.COM ")).body.result.structuredContent.user
        .id,
      "reader",
    );
    const list = (await call("list_posts")).body.result.structuredContent;
    assert.deepEqual(
      list.items.map((item: { id: string }) => item.id),
      ["public"],
    );
    assert.ok(!JSON.stringify(list).includes("@example.com"));
    assert.equal(
      (await call("search_posts", { query: "SECRET_KEYWORD" })).body.result.structuredContent.total,
      0,
    );
    assert.equal(
      (await call("search_posts", { query: "关键词" })).body.result.structuredContent.total,
      1,
    );
    assert.equal(
      (await call("list_posts", {}, "owner@example.com")).body.result.structuredContent.total,
      2,
    );
    for (const name of [
      "get_post_content",
      "list_post_images",
      "get_image",
      "list_annotations",
      "list_annotation_replies",
      "list_comments",
    ]) {
      const blocked = await call(name, {
        postId: "private",
        ...(name === "get_image" ? { assetId: "private-image" } : {}),
        ...(name === "list_annotation_replies" ? { annotationId } : {}),
      });
      assert.equal(blocked.body.result.isError, true, name);
      assert.ok(!JSON.stringify(blocked.body).includes("SECRET"));
    }
    const body = (await call("get_post_content", { postId: "public", limit: 7 })).body.result
      .structuredContent;
    assert.equal(body.images[0].id, "public-image");
    assert.ok(!JSON.stringify(body).includes("STORAGE_KEY"));
    let text = body.markdown;
    let next = body.nextOffset;
    while (next !== null) {
      const part = (await call("get_post_content", { postId: "public", offset: next, limit: 7 }))
        .body.result.structuredContent;
      text += part.markdown;
      next = part.nextOffset;
    }
    assert.equal(
      text,
      sqlite.prepare("SELECT markdown FROM posts WHERE id='public'").get()!.markdown,
    );
    assert.equal(
      (await call("list_post_images", { postId: "public" })).body.result.structuredContent.items[0]
        .filename,
      "photo.png",
    );
    imageReads = 0;
    assert.equal(
      (await call("get_image", { postId: "public", assetId: "private-image" })).body.result.isError,
      true,
    );
    assert.equal(imageReads, 0);
    const image = (await call("get_image", { postId: "public", assetId: "public-image" })).body
      .result;
    assert.equal(image.content[1].type, "image");
    assert.equal(image.content[1].data, imageBytes.toString("base64"));
    assert.equal(imageReads, 1);
    assert.equal(
      (await call("list_annotations", { postId: "public" })).body.result.structuredContent.items[0]
        .markdown,
      "批注内容",
    );
    assert.equal(
      (await call("list_annotation_replies", { postId: "public", annotationId })).body.result
        .structuredContent.items[0].markdown,
      "批注回复",
    );
    assert.equal(
      (await call("list_annotation_replies", { postId: "public", annotationId: "unknown" })).body
        .result.isError,
      true,
    );
    const comments = (await call("list_comments", { postId: "public", pageSize: 1 })).body.result
      .structuredContent;
    assert.equal(comments.items[0].markdown, "评论内容");
    assert.ok(!JSON.stringify(comments).includes("HIDDEN_COMMENT"));
    sqlite.exec("UPDATE annotations SET hidden_at=2; UPDATE annotation_replies SET hidden_at=2;");
    assert.ok(
      !JSON.stringify((await call("list_annotations", { postId: "public" })).body).includes(
        "批注内容",
      ),
    );
    assert.ok(
      !JSON.stringify(
        (await call("list_annotation_replies", { postId: "public", annotationId })).body,
      ).includes("批注回复"),
    );
    sqlite.exec("UPDATE posts SET deleted_at=2 WHERE id='public'");
    assert.equal(
      (await call("get_post_content", { postId: "public" })).body.result.structuredContent.markdown,
      "",
    );
    assert.equal(
      (await call("get_image", { postId: "public", assetId: "public-image" })).body.result.isError,
      true,
    );
    assert.equal(
      (await call("list_comments", { postId: "public" })).body.result.structuredContent.items[0]
        .markdown,
      "评论内容",
    );
    sqlite.exec("DELETE FROM allowed_users WHERE id='reader'");
    assert.equal((await call("list_posts")).response.status, 403);
    assert.equal(logged, 0, "expected denials are not server failures");
  } finally {
    sqlite.close();
  }
});
