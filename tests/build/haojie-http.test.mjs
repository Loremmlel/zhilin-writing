import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { encodeReply } from "react-server-dom-webpack/client.edge";
import { Miniflare } from "miniflare";
import { Window } from "happy-dom";

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
    let db = await mf.getD1Database("DB");
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
      if (file.startsWith("0016_")) {
        await db.batch([
          db.prepare(
            "INSERT INTO users(id,email_key,display_name,joined_at,updated_at) VALUES ('legacy-player','legacy-player@example.test','旧玩家',0,0), ('legacy-other','legacy-other@example.test','旧对手',0,0)",
          ),
          db.prepare(`INSERT INTO haojie_rooms (id,player1_id,player2_id,creation_request_id,mode,status,revision,state_json,engine_version,ruleset,view_version,last_change,winner,end_reason,created_at,updated_at)
            VALUES ('00000000-0000-4000-8000-000000000001','legacy-player','legacy-other','legacy','classic','finished',3,'{}','old','old',1,'resign','2','resign',0,3)`),
          db.prepare(
            `INSERT INTO haojie_history VALUES ('00000000-0000-4000-8000-000000000001',2,'{"step":1}'),('00000000-0000-4000-8000-000000000001',3,'{"step":2}')`,
          ),
        ]);
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
    // Exercise the production multipart path and real D1/R2, including the
    // largest allowed attachment plus form overhead (not just client checks).
    const sendAsset = async (size, type, actor = "a") => {
      const body = new FormData();
      body.set("file", new Blob([new Uint8Array(size)], { type }), "upload.bin");
      const encoded = new Request("https://site.test/api/assets", {
        method: "POST",
        headers: {
          Origin: (await mf.ready).origin,
          "oai-authenticated-user-email": `${actor}@example.test`,
        },
        body,
      });
      return mf.dispatchFetch(encoded.url, {
        method: "POST",
        headers: Object.fromEntries(encoded.headers),
        body: await encoded.arrayBuffer(),
      });
    };
    for (const [size, type] of [
      [2_319_000, "image/png"],
      [10 * 1024 * 1024, "image/png"],
      [20 * 1024 * 1024, "application/pdf"],
    ]) {
      const { asset } = await json(await sendAsset(size, type), 201);
      assert.equal(asset.byteSize, size);
      assert.equal((await bucket.head(asset.r2Key)).size, size);
      assert.equal(
        (await db.prepare("SELECT byte_size FROM assets WHERE id=?").bind(asset.id).first())
          .byte_size,
        size,
      );
    }
    for (const [size, type] of [
      [10 * 1024 * 1024 + 1, "image/png"],
      [20 * 1024 * 1024 + 1, "application/pdf"],
    ])
      assert.equal((await json(await sendAsset(size, type), 400)).code, "SIZE_LIMIT");
    assert.equal((await sendAsset(21 * 1024 * 1024, "application/pdf")).status, 413);
    assert.equal(
      (await json(await sendAsset(2_319_000, "image/png", "b"), 403)).code,
      "WRITING_REQUIRED",
    );
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
    // Password login uses the same profile/permissions and survives the complete built HTTP boundary.
    const loginHtml = await (await request("/login")).text();
    assert.match(loginHtml, /使用 ChatGPT 登录/);
    const password = "built-worker test password";
    const resetPassword = "built-worker replacement password";
    const setPassword = (value, actor = "a") =>
      action("setMemberPasswordAction", actor, [
        {},
        form({ id: "b", password: value, confirmPassword: value }),
      ]);
    assert.match(await (await setPassword(password, "b")).text(), /ADMIN_REQUIRED/);
    assert.equal(
      await db
        .prepare("SELECT password_hash FROM member_passwords WHERE allowed_user_id='b'")
        .first(),
      null,
    );
    assert.match(await (await setPassword(password)).text(), /"success":true/);
    const passwordResponse = await request("/api/auth/login", undefined, {
      email: " B@EXAMPLE.TEST ",
      password,
      returnTo: "/games/haojie",
    });
    const cookie = passwordResponse.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    assert.deepEqual(await json(passwordResponse), { returnTo: "/games/haojie" });
    const passwordRequest = (path, body, origin = "https://site.test") =>
      mf.dispatchFetch(`https://site.test${path}`, {
        method: body ? "POST" : "GET",
        redirect: "manual",
        headers: {
          Cookie: cookie.split(";")[0],
          "oai-authenticated-user-email": "a@example.test",
          ...(body ? { Origin: origin, "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const passwordLobby = await passwordRequest("/games/haojie");
    assert.equal(passwordLobby.status, 200);
    assert.match(await passwordLobby.text(), /创建房间/);
    assert.equal(
      (await json(await passwordRequest("/api/docx-import", {}), 403)).error.code,
      "WRITING_REQUIRED",
    );
    assert.equal((await passwordRequest("/api/haojie/rooms", {}, "https://evil.test")).status, 403);
    const logout = await passwordRequest("/api/auth/logout", {});
    assert.equal(logout.status, 303, (await logout.text()).slice(0, 2000));
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    assert.match(logout.headers.get("location"), /\/signout-with-chatgpt/);
    assert.equal(
      (await json(await passwordRequest("/api/haojie/rooms"), 401)).error.code,
      "AUTH_EXPIRED",
    );
    const secondLogin = await request("/api/auth/login", undefined, {
      email: "b@example.test",
      password,
    });
    const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
    await json(secondLogin);
    assert.match(await (await setPassword(resetPassword)).text(), /"success":true/);
    assert.equal(
      (
        await mf.dispatchFetch("https://site.test/api/haojie/rooms", {
          headers: { Cookie: secondCookie },
        })
      ).status,
      401,
    );
    await json(
      await request("/api/auth/login", undefined, { email: "b@example.test", password }),
      401,
    );
    await json(
      await request("/api/auth/login", undefined, {
        email: "b@example.test",
        password: resetPassword,
      }),
    );
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
    assert.equal(joined.update.view.ruleset, "3.0-feedback5-live-deployment");
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
    assert.match(gameHtml, /aria-label="悔棋"/);
    assert.doesNotMatch(gameHtml, /aria-label="重做"/);
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
    const asked = await json(
      await request(`${path}/undo`, "a", input(2, { kind: "undo-request" })),
    );
    assert.equal(asked.undo.status, "pending");
    const undoInput = input(3, { kind: "undo-accept", undoId: asked.undo.id });
    await json(await request(`${path}/undo`, "c", undoInput), 404);
    await json(await request(`${path}/undo`, "a", undoInput), 409);
    const accepted = await json(await request(`${path}/undo`, "b", undoInput));
    assert.equal(accepted.receipt.revision, 4);
    assert.equal(accepted.undo.status, "accepted");
    assert.equal(accepted.update.kind, "snapshot");
    assert.deepEqual(accepted.update.view.state, joined.update.view.state);
    assert.equal((await json(await request(`${path}/undo`, "b", undoInput))).receipt.revision, 4);
    await db.prepare("DELETE FROM allowed_users WHERE id = 'b'").run();
    await json(await request(`${path}?after=2`, "b"), 403);
    await json(await request(`${path}/reactions`, "b", emojis), 403);
    await json(await request(`${path}/undo`, "b", input(4, { kind: "undo-request" })), 403);
    const ended = await json(await request(`${path}/finish`, "a", input(4, { kind: "resign" })));
    assert.equal(ended.room.winner, 2);
    assert.equal(ended.room.status, "finished");
    let automaticArchive;
    for (let attempt = 0; attempt < 50; attempt++) {
      automaticArchive = await db
        .prepare("SELECT archive_key FROM haojie_rooms WHERE id = ?")
        .bind(created.room.id)
        .first();
      if (automaticArchive.archive_key) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(
      automaticArchive.archive_key,
      "terminal request automatically uploads without an admin action",
    );
    // Admin-only archive surface, actual streamed R2 bytes, undo history, and idempotent retry.
    const download = `/api/admin/games/${created.room.id}/download`;
    await json(await request(download), 401);
    await json(await request(download, "c"), 403);
    const archivedAction = await action("manageGameArchive", "a", [
      created.room.id,
      5,
      "archive",
      {},
      new FormData(),
    ]);
    assert.match(await archivedAction.text(), /"success":true/);
    const downloaded = await request(download, "a");
    assert.match(downloaded.headers.get("content-disposition"), /attachment/);
    const archive = await json(downloaded);
    assert.equal(archive.formatVersion, 2);
    assert.equal(archive.room.historyComplete, true);
    assert.equal(archive.room.endReason, "resign");
    assert.deepEqual(
      archive.records.map((r) => r.kind),
      ["join", "command", "undo-request", "undo-accept", "resign"],
    );
    assert.equal(typeof archive.records[0].initial.rng, "number");
    assert.deepEqual(archive.present, archive.records[0].initial);
    assert.equal(
      archive.records.slice(1).some((record) => "state" in record),
      false,
    );
    assert.equal(archive.records[1].command.type, "summon");
    assert.equal(archive.records[3].undoneCommandRevision, 2);
    const page = await request("/admin/games", "a");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /下载 JSON/);
    const denied = await action("manageGameArchive", "c", [
      created.room.id,
      5,
      "archive",
      {},
      new FormData(),
    ]);
    assert.match(await denied.text(), /ADMIN_REQUIRED/);
    const legacyId = "00000000-0000-4000-8000-000000000001";
    // Missing object storage does not lose a terminal game's records.
    await mf.setOptions({ ...options, r2Buckets: [] });
    db = await mf.getD1Database("DB");
    assert.match(
      await (
        await action("manageGameArchive", "a", [legacyId, 3, "archive", {}, new FormData()])
      ).text(),
      /归档失败/,
    );
    assert.equal(
      (await db.prepare("SELECT archive_key FROM haojie_rooms WHERE id = ?").bind(legacyId).first())
        .archive_key,
      null,
    );
    await mf.setOptions(options);
    db = await mf.getD1Database("DB");
    // Force failure after R2 upload: the same object is safely finalized by retry.
    await db
      .prepare(
        "CREATE TRIGGER fail_archive BEFORE UPDATE OF archive_key ON haojie_rooms BEGIN SELECT RAISE(ABORT, 'test'); END",
      )
      .run();
    const failed = await action("manageGameArchive", "a", [
      legacyId,
      1,
      "archive",
      {},
      new FormData(),
    ]);
    assert.match(await failed.text(), /归档失败/);
    assert.equal(
      (await db.prepare("SELECT archive_key FROM haojie_rooms WHERE id = ?").bind(legacyId).first())
        .archive_key,
      null,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM haojie_records WHERE room_id = ?")
          .bind(legacyId)
          .first()
      ).n,
      3,
    );
    await db.prepare("DROP TRIGGER fail_archive").run();
    assert.match(
      await (
        await action("manageGameArchive", "a", [legacyId, 1, "archive", {}, new FormData()])
      ).text(),
      /"success":true/,
    );
    const legacy = await json(await request(`/api/admin/games/${legacyId}/download`, "a"));
    assert.equal(legacy.formatVersion, 1);
    assert.equal(legacy.room.historyComplete, false);
    assert.deepEqual(
      legacy.records.map((r) => r.kind),
      ["legacy-snapshot", "legacy-snapshot", "legacy-baseline"],
    );
    assert.equal(legacy.records[0].state.step, 1);
    const toAbort = await json(
      await request("/api/haojie/rooms", "a", { requestId: crypto.randomUUID(), mode: "classic" }),
    );
    await json(
      await request(`/api/haojie/rooms/${toAbort.room.id}/join`, "c", {
        requestId: crypto.randomUUID(),
        baseRevision: 0,
        engineVersion: toAbort.room.engineVersion,
      }),
    );
    assert.match(
      await (
        await action("manageGameArchive", "a", [toAbort.room.id, 0, "abort", {}, new FormData()])
      ).text(),
      /局面已变化/,
    );
    assert.match(
      await (
        await action("manageGameArchive", "c", [toAbort.room.id, 1, "abort", {}, new FormData()])
      ).text(),
      /ADMIN_REQUIRED/,
    );
    assert.match(
      await (
        await action("manageGameArchive", "a", [toAbort.room.id, 1, "abort", {}, new FormData()])
      ).text(),
      /"success":true/,
    );
    const abortedRoom = await json(await request(`/api/haojie/rooms/${toAbort.room.id}`, "c"));
    assert.equal(abortedRoom.room.endReason, "aborted");
    assert.equal(abortedRoom.room.winner, null);
    const abortedPage = await request(`/games/haojie/${toAbort.room.id}`, "c");
    assert.match(await abortedPage.text(), /管理员已结束本局/);
    const abortedArchive = await json(
      await request(`/api/admin/games/${toAbort.room.id}/download`, "a"),
    );
    assert.equal(abortedArchive.records.at(-1).actorId, "a");
    assert.equal(abortedArchive.records.at(-1).kind, "admin-abort");
    await mf.setOptions({ ...options, bindings: { HAOJIE_ENABLED: "false" } });
    assert.equal((await json(await request(path, "a"), 404)).error.code, "GAME_UNAVAILABLE");
    await mf.setOptions(options);
    db = await mf.getD1Database("DB");
    assert.equal(
      (await json(await request(path, "a"))).room.status,
      "finished",
      "room survives a Worker restart",
    );
    await (
      await mf.getD1Database("DB")
    )
      .prepare("UPDATE haojie_rooms SET engine_version = ?, ruleset = '3.0-feedback3' WHERE id = ?")
      .bind("7824f47c0deb0797819833f6641021f87f4aecbd", created.room.id)
      .run();
    const historical = await request(`/games/haojie/${created.room.id}`, "a");
    const historicalHtml = await historical.text();
    assert.equal(historical.status, 200);
    assert.match(historicalHtml, /class="hj-game/);
    assert.match(historicalHtml, /已结束/);
    assert.doesNotMatch(historicalHtml, /版本不兼容|这个区域暂时无法显示/);

    // Exercise separate profile and content destinations in the real built Worker.
    await db.batch([
      db.prepare(
        "INSERT INTO posts(id,author_id,title,markdown,search_text,published_at,last_activity_at) VALUES('profile-post','c','用户入口测试','正文','正文',1,1)",
      ),
      db.prepare(
        "INSERT INTO replies(id,post_id,author_id,markdown,published_at) VALUES('profile-reply','profile-post','c','普通回复',1)",
      ),
      db.prepare(
        "INSERT INTO replies(id,post_id,author_id,root_reply_id,reply_to_reply_id,reply_to_user_id,markdown,published_at) VALUES('profile-child','profile-post','a','profile-reply','profile-reply','c','子回复',2)",
      ),
      db.prepare(
        "INSERT INTO activity_events(id,actor_user_id,event_type,post_id,reply_id,created_at) VALUES('profile-event','c','POST_REPLY_CREATED','profile-post','profile-reply',1)",
      ),
      db.prepare(
        "INSERT INTO notifications(id,recipient_user_id,actor_user_id,event_id,notification_type,post_id,reply_id,created_at) VALUES('profile-notice','a','c','profile-event','POST_REPLY_RECEIVED','profile-post','profile-reply',1)",
      ),
    ]);
    const window = new Window({
      url: "https://site.test",
      settings: {
        disableCSSFileLoading: true,
        disableJavaScriptFileLoading: true,
        disableJavaScriptEvaluation: true,
      },
    });
    try {
      const page = async (route) => {
        const response = await request(route, "a");
        assert.equal(response.status, 200, route);
        const document = window.document;
        document.body.innerHTML = await response.text();
        assert.equal(document.querySelectorAll("a a").length, 0, "no nested navigation links");
        return document;
      };
      const home = await page("/");
      assert.equal(home.querySelectorAll('.post-card .profile-link[href="/users/c"]').length, 2);
      const post = await page("/posts/profile-post");
      assert.equal(
        post.querySelectorAll('#reply-profile-reply .profile-link[href="/users/c"]').length,
        2,
      );
      assert.equal(
        post.querySelectorAll('#reply-profile-child .profile-link[href="/users/a"]').length,
        2,
      );
      assert.equal(
        post.querySelector('#reply-profile-child .profile-link[href="/users/c"]').textContent,
        "丙",
      );
      const notices = await page("/notifications");
      const notice = notices.querySelector(".notification-item");
      assert.equal(notice.tagName, "ARTICLE");
      assert.equal(notice.querySelectorAll('.profile-link[href="/users/c"]').length, 2);
      assert.equal(
        notice.querySelector(".notification-detail-link").getAttribute("href"),
        "/notifications/profile-notice",
      );
      const activity = await page("/users/c?tab=activity");
      assert.equal(
        activity.querySelector(".activity-content .profile-link").getAttribute("href"),
        "/users/c",
      );
      assert.equal(
        (await db.prepare("SELECT read_at FROM notifications WHERE id='profile-notice'").first())
          .read_at,
        null,
        "profile visits do not read the notification",
      );
      await (await request("/notifications/profile-notice", "a")).text();
      assert.ok(
        (await db.prepare("SELECT read_at FROM notifications WHERE id='profile-notice'").first())
          .read_at,
        "notification destination still marks it read",
      );
    } finally {
      await window.happyDOM.close();
    }
  } finally {
    await mf.dispose();
  }
});
