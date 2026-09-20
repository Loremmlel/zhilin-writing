import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
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
      const sql = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
      await db.batch(
        sql
          .split("--> statement-breakpoint")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => db.prepare(part)),
      );
    }
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
    await json(
      await request(`${path}/commands`, "b", input(2, { command: { type: "summon", player: 1 } })),
      422,
    );
    await db.prepare("DELETE FROM allowed_users WHERE id = 'b'").run();
    await json(await request(`${path}?after=2`, "b"), 403);
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
