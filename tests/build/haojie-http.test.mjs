import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { encodeReply } from "react-server-dom-webpack/client.edge";
import { Miniflare } from "miniflare";

test("built Worker serves authenticated two-player HTTP rooms and existing pages on isolated D1", async () => {
  const root = fileURLToPath(new URL("../../dist/server/", import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter(
    (file) => file.endsWith(".js") && file !== "index.js",
  );
  const options = {
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
  };
  const mf = new Miniflare(options);
  try {
    const db = await mf.getD1Database("DB");
    const migrations = (await readdir(new URL("../../drizzle/", import.meta.url)))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    for (const file of migrations) {
      if (file.startsWith("0013_")) {
        await db
          .prepare(
            "INSERT INTO allowed_users(id,email,is_admin,added_at,added_by_user_id) VALUES ('legacy','legacy@example.test',0,0,'test-owner')",
          )
          .run();
      }
      const sql = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
      await db.batch(
        sql
          .split("--> statement-breakpoint")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => db.prepare(part)),
      );
    }
    assert.equal(
      (await db.prepare("SELECT permission_group FROM allowed_users WHERE id='legacy'").first())
        .permission_group,
      "normal",
    );
    for (const [id, name] of [
      ["a", "甲"],
      ["b", "乙"],
      ["c", "丙"],
    ]) {
      await db.batch([
        db
          .prepare(
            "INSERT INTO users (id,email_key,display_name,joined_at,updated_at) VALUES (?,?,?,0,0)",
          )
          .bind(id, `${id}@example.test`, name),
        db
          .prepare(
            "INSERT INTO allowed_users (id,email,is_admin,added_at,added_by_user_id) VALUES (?,?,0,0,'test-owner')",
          )
          .bind(id, `${id}@example.test`),
      ]);
    }
    await db.prepare("UPDATE allowed_users SET permission_group='game' WHERE id='b'").run();
    await db
      .prepare(
        "INSERT INTO posts(id,author_id,title,markdown,search_text,published_at,last_activity_at,visibility_user_ids) VALUES('private-post','a','私密随笔标题','私密随笔正文','私密随笔正文',0,0,'[\"a\",\"b\"]')",
      )
      .run();
    const request = (path, actor, body) =>
      mf.dispatchFetch(`https://site.test${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          ...(actor ? { "oai-authenticated-user-email": `${actor}@example.test` } : {}),
          ...(body ? { Origin: "https://site.test", "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const json = async (response, status = 200) => {
      const body = await response.text();
      assert.equal(response.status, status, body.slice(0, 4000));
      return JSON.parse(body);
    };
    assert.equal((await json(await request("/api/haojie/rooms"), 401)).error.code, "AUTH_EXPIRED");
    assert.equal(
      (await json(await request("/api/haojie/rooms", "unknown"), 403)).error.code,
      "ACCESS_REVOKED",
    );
    const home = await request("/", "a");
    const homeHtml = await home.text();
    assert.equal(home.status, 200);
    assert.match(homeHtml, /知临中学/);
    assert.doesNotMatch(homeHtml, /(?:src|href)="\/assets\/room-[^"]+\.js"/);
    const lobby = await request("/games/haojie", "a");
    const lobbyHtml = await lobby.text();
    assert.equal(lobby.status, 200);
    assert.match(lobbyHtml, /创建房间/);
    assert.match(lobbyHtml, /暂无未结束的对局/);
    // Game members cannot discover writing content through any page or resource entry point.
    for (const route of [
      "/",
      "/posts/private-post",
      "/posts/new",
      "/posts/import",
      "/posts/private-post/edit",
      "/users/a",
      "/users/b?tab=activity",
      "/search?q=私密",
      "/tags",
      "/tags/校园",
      "/notifications",
      "/notifications/missing",
      "/admin",
    ]) {
      const response = await request(route, "b");
      const html = await response.text();
      assert.doesNotMatch(html, /私密随笔标题|私密随笔正文/, route);
      assert.ok([200, 302, 303, 307].includes(response.status), `${route}: ${response.status}`);
      assert.ok(response.headers.get("location") || html.includes("/games/haojie"), route);
    }
    const gameLobby = await request("/games/haojie", "b");
    const gameLobbyHtml = await gameLobby.text();
    assert.equal(gameLobby.status, 200);
    assert.match(gameLobbyHtml, /创建房间/);
    assert.doesNotMatch(
      gameLobbyHtml,
      /href="\/(?:posts|notifications|search|tags|users)(?:[/?"])/,
    );
    const profile = await request("/settings/profile", "b");
    assert.equal(profile.status, 200);
    assert.match(await profile.text(), /保存资料/);
    assert.equal(
      (await json(await request("/api/docx-import", "b", {}), 403)).error.code,
      "WRITING_REQUIRED",
    );
    const bucket = await mf.getR2Bucket("BUCKET");
    for (const [id, owner, kind, status] of [
      ["image", "a", "image", "permanent"],
      ["own-upload", "b", "image", "temporary"],
      ["avatar", "b", "avatar", "permanent"],
    ]) {
      await bucket.put(id, "private-asset-bytes");
      await db
        .prepare(
          "INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES(?,?,?,?,?,'image/png',19,?,0)",
        )
        .bind(id, owner, id, kind, `${id}.png`, status)
        .run();
    }
    await db
      .prepare(
        "INSERT INTO post_asset_refs(post_id,asset_id,usage) VALUES('private-post','image','inline')",
      )
      .run();
    await db.prepare("UPDATE users SET avatar_asset_id='avatar' WHERE id='b'").run();
    for (const id of ["image", "own-upload"])
      assert.equal((await request(`/api/assets/${id}`, "b")).status, 404);
    assert.equal((await request("/api/assets/avatar", "b")).status, 200);
    assert.equal((await request("/api/assets/image", "a")).status, 200);
    const upload = new FormData();
    upload.set("file", new Blob(["content"], { type: "text/plain" }), "essay.txt");
    const uploadRequest = new Request("https://site.test/api/assets", {
      method: "POST",
      headers: { "oai-authenticated-user-email": "b@example.test" },
      body: upload,
    });
    const uploadResponse = await mf.dispatchFetch(uploadRequest.url, {
      method: "POST",
      headers: Object.fromEntries(uploadRequest.headers),
      body: await uploadRequest.arrayBuffer(),
    });
    assert.equal((await json(uploadResponse, 403)).code, "WRITING_REQUIRED");
    const source = await readFile(join(root, "index.js"), "utf8");
    const action = async (name, actor, args) => {
      const match = source.match(
        new RegExp(`registerServerReference\\(${name}, "([^"]+)", "${name}"\\)`),
      );
      assert.ok(match, `built action: ${name}`);
      const encoded = new Request("https://site.test/games/haojie", {
        method: "POST",
        headers: {
          Origin: (await mf.ready).origin,
          "oai-authenticated-user-email": `${actor}@example.test`,
          "next-action": `${match[1]}#${name}`,
        },
        body: await encodeReply(args),
      });
      return mf.dispatchFetch(encoded.url, {
        method: "POST",
        headers: Object.fromEntries(encoded.headers),
        body: await encoded.arrayBuffer(),
      });
    };
    const form = (values) => {
      const data = new FormData();
      for (const [key, value] of Object.entries(values)) data.set(key, value);
      return data;
    };
    for (const [name, args] of [
      ["createPostAction", [{}, form({ title: "未授权写入", markdown: "未授权正文" })]],
      ["createReplyAction", ["private-post", null, {}, new FormData()]],
      ["createAnnotationAction", ["private-post", {}, new FormData()]],
      ["createAnnotationReplyAction", ["private-post", "missing", null, {}, new FormData()]],
      ["markAllNotificationsReadAction", [{}, new FormData()]],
    ])
      assert.match(await (await action(name, "b", args)).text(), /WRITING_REQUIRED/, name);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM posts").first()).n, 1);
    const savedProfile = await action("updateProfileAction", "b", [
      {},
      form({ displayName: "乙的新昵称", bio: "个人简介" }),
    ]);
    assert.equal(
      (await db.prepare("SELECT display_name FROM users WHERE id='b'").first()).display_name,
      "乙的新昵称",
    );
    assert.ok([...savedProfile.headers.values()].some((value) => value === "/games/haojie"));
    await db.prepare("UPDATE users SET display_name='乙' WHERE id='b'").run();
    await db.prepare("UPDATE allowed_users SET is_admin=1 WHERE id='a'").run();
    assert.match(
      await (
        await action("addAllowlistAction", "b", [
          {},
          form({ email: "unauthorized@test", permissionGroup: "normal" }),
        ])
      ).text(),
      /ADMIN_REQUIRED/,
    );
    const invited = await action("addAllowlistAction", "a", [
      {},
      form({ email: "new-game@test", permissionGroup: "game" }),
    ]);
    await invited.text();
    const newInvite = await db
      .prepare("SELECT * FROM allowed_users WHERE email='new-game@test'")
      .first();
    assert.equal(newInvite.permission_group, "game");
    assert.equal(newInvite.is_admin, 0);
    await (
      await action("updatePermissionGroupAction", "a", [
        {},
        form({ id: newInvite.id, permissionGroup: "normal" }),
      ])
    ).text();
    assert.equal(
      (
        await db
          .prepare("SELECT permission_group FROM allowed_users WHERE id=?")
          .bind(newInvite.id)
          .first()
      ).permission_group,
      "normal",
    );
    await (
      await action("updatePermissionGroupAction", "a", [
        {},
        form({ id: "a", permissionGroup: "game" }),
      ])
    ).text();
    assert.equal(
      (await db.prepare("SELECT permission_group FROM allowed_users WHERE id='a'").first())
        .permission_group,
      "normal",
    );
    await (
      await action("updatePermissionGroupAction", "a", [
        {},
        form({ id: "b", permissionGroup: "administrator" }),
      ])
    ).text();
    assert.equal(
      (await db.prepare("SELECT permission_group FROM allowed_users WHERE id='b'").first())
        .permission_group,
      "game",
    );
    const adminPage = await request("/admin?section=members", "a");
    const adminHtml = await adminPage.text();
    assert.equal(adminPage.status, 200);
    assert.match(adminHtml, /修改权限组/);
    assert.match(adminHtml, /游戏组/);
    // A fresh request observes a group change immediately, even with an existing post allowlist.
    await db.prepare("UPDATE allowed_users SET permission_group='normal' WHERE id='b'").run();
    assert.match(await (await request("/", "b")).text(), /私密随笔标题/);
    await db.prepare("UPDATE allowed_users SET permission_group='game' WHERE id='b'").run();
    assert.doesNotMatch(await (await request("/", "b")).text(), /私密随笔标题/);
    const created = await json(
      await request("/api/haojie/rooms", "a", { requestId: crypto.randomUUID(), mode: "classic" }),
    );
    const path = `/api/haojie/rooms/${created.room.id}`;
    const input = (baseRevision, fields = {}) => ({
      requestId: crypto.randomUUID(),
      engineVersion: created.room.engineVersion,
      baseRevision,
      ...fields,
    });
    const joined = await json(await request(`${path}/join`, "b", input(0)));
    assert.equal(joined.room.viewer, 2);
    assert.equal(joined.room.player2.name, "乙");
    assert.equal(joined.room.revision, 1);
    assert.equal("seed" in joined.update.view.state, false);
    assert.equal("rng" in joined.update.view.state, false);
    await json(await request(path, "c"), 404);
    const game = await request(`/games/haojie/${created.room.id}`, "a");
    const gameHtml = await game.text();
    assert.equal(game.status, 200);
    assert.match(gameHtml, /浩劫/);
    assert.match(gameHtml, /class="hj-game/);
    assert.match(gameHtml, /认输/);
    assert.match(gameHtml, /发送表情/);
    assert.doesNotMatch(gameHtml, /这个区域暂时无法显示|HAOJIE_DATABASE_UNAVAILABLE/);
    const command = input(1, { command: { type: "summon" } });
    const moved = await json(await request(`${path}/commands`, "a", command));
    assert.equal(moved.receipt.revision, 2);
    assert.equal((await json(await request(`${path}/commands`, "a", command))).receipt.revision, 2);
    const observed = await json(await request(`${path}?after=1`, "b"));
    assert.equal(observed.update.view.viewer, 2);
    assert.equal(observed.update.kind, "update");
    const unchanged = await request(`${path}?after=2`, "b");
    assert.equal(unchanged.status, 204);
    assert.match(unchanged.headers.get("cache-control"), /no-store/);
    const emojis = {
      items: [
        { id: crypto.randomUUID(), emoji: "😂" },
        { id: crypto.randomUUID(), emoji: "👍" },
      ],
    };
    const sentEmojis = await json(await request(`${path}/reactions`, "b", emojis));
    assert.equal(sentEmojis.reactions.sequence, 2);
    assert.equal(sentEmojis.reactions.items[0].player, 2);
    assert.equal(
      (await json(await request(`${path}/reactions`, "b", emojis))).reactions.sequence,
      2,
    );
    const emojiPoll = await json(await request(`${path}?after=2&afterReaction=0`, "a"));
    assert.equal(emojiPoll.room.revision, 2);
    assert.equal(emojiPoll.update, null);
    assert.deepEqual(emojiPoll.reactions, sentEmojis.reactions);
    assert.equal((await request(`${path}?after=2&afterReaction=2`, "a")).status, 204);
    await json(await request(`${path}/reactions`, "c", emojis), 404);
    await json(await request(`${path}/reactions`, "b", { ...emojis, player: 1 }), 400);
    await json(
      await request(`${path}/reactions`, "b", {
        items: [{ id: crypto.randomUUID(), emoji: "invalid" }],
      }),
      400,
    );
    await json(
      await request(`${path}/commands`, "b", input(2, { command: { type: "summon", player: 1 } })),
      422,
    );
    await db.prepare("DELETE FROM allowed_users WHERE id = 'b'").run();
    await json(await request(`${path}?after=2`, "b"), 403);
    await json(await request(`${path}/reactions`, "b", emojis), 403);
    const ended = await json(await request(`${path}/finish`, "a", input(2, { kind: "resign" })));
    assert.equal(ended.room.winner, 2);
    assert.equal(ended.room.status, "finished");
    await mf.setOptions({ ...options, bindings: { HAOJIE_ENABLED: "false" } });
    assert.equal((await json(await request(path, "a"), 404)).error.code, "GAME_UNAVAILABLE");
    await mf.setOptions(options);
    assert.equal(
      (await json(await request(path, "a"))).room.status,
      "finished",
      "room survives a Worker restart",
    );
  } finally {
    await mf.dispose();
  }
});
