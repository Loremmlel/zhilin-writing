import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import type { MutationInput } from "../../lib/haojie/contracts.ts";

// Bundle the unmodified upstream extensionless imports, using the installed build tool.
const bundled = await build({
  stdin: {
    contents: `export * from './lib/haojie/service.ts'; export * from './lib/haojie/input.ts'; export * from './lib/haojie/contracts.ts';`,
    resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const api = (await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`
)) as typeof import("../../lib/haojie/service.ts") &
  typeof import("../../lib/haojie/input.ts") &
  typeof import("../../lib/haojie/contracts.ts");
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('test'); } }",
  compatibilityDate: "2026-04-01",
  d1Databases: ["DB"],
});
let db: D1Database;
before(async () => {
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  await db.prepare("CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL)").run();
  const migration = await readFile(
    new URL("../../drizzle/0012_haojie_online.sql", import.meta.url),
    "utf8",
  );
  await db.batch(migration.split("--> statement-breakpoint").map((sql) => db.prepare(sql.trim())));
  await db
    .prepare(
      await readFile(
        new URL("../../drizzle/0014_closed_rocket_raccoon.sql", import.meta.url),
        "utf8",
      ),
    )
    .run();
  await db.prepare("INSERT INTO users VALUES ('a', '甲'), ('b', '乙'), ('c', '丙')").run();
});
after(() => mf.dispose());
const input = (kind: MutationInput["kind"], revision: number, extra = {}): MutationInput =>
  ({
    kind,
    requestId: crypto.randomUUID(),
    engineVersion: api.HAOJIE_ENGINE_VERSION,
    baseRevision: revision,
    ...extra,
  }) as MutationInput;
const rejection = (code: string) => (error: unknown) =>
  error instanceof api.HaojieError && error.code === code;
async function room(mode: "classic" | "shrine" = "classic") {
  // Independent test cases should not exercise the intentional admission-rate limit.
  await db.prepare("UPDATE haojie_rooms SET created_at = 0").run();
  await db.prepare("UPDATE haojie_requests SET created_at = 0").run();
  return api.createRoom(db, "a", crypto.randomUUID(), mode);
}
function noPrivate(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!["seed", "rng", "past", "future"].includes(key), `private ${key}`);
    noPrivate(child);
  }
}

test("room lifecycle binds seats, deduplicates creation and atomically admits only one guest", async () => {
  const key = crypto.randomUUID();
  const created = await api.createRoom(db, "a", key, "classic");
  assert.equal((await api.createRoom(db, "a", key, "classic")).room.id, created.room.id);
  await assert.rejects(api.createRoom(db, "a", key, "shrine"), rejection("REQUEST_REUSED"));
  assert.equal(created.room.viewer, 1);
  const invite = (await api.getRoom(db, created.room.id, "b"))!;
  assert.equal(invite.room.viewer, null);
  assert.equal(invite.update, null);
  const joins = await Promise.allSettled(
    ["b", "c"].map((actor) => api.mutateRoom(db, created.room.id, actor, input("join", 0))),
  );
  assert.equal(joins.filter((result) => result.status === "fulfilled").length, 1);
  const current = (await api.getRoom(db, created.room.id, "a"))!;
  assert.equal(current.room.revision, 1);
  assert.equal(current.room.status, "playing");
  const guest = current.room.player2!.id;
  assert.equal((await api.mutateRoom(db, created.room.id, guest, input("join", 0))).room.viewer, 2);
  await assert.rejects(
    api.getRoom(db, created.room.id, guest === "b" ? "c" : "b"),
    rejection("ROOM_UNAVAILABLE"),
  );
  noPrivate(current);
  assert.equal(await api.getRoom(db, created.room.id, "a", 1), null);
  const resign = input("resign", 1);
  const end = await api.mutateRoom(db, created.room.id, guest, resign);
  assert.equal(end.room.winner, 1);
  assert.equal(end.room.endReason, "resign");
  assert.equal(end.update?.kind, "snapshot");
  assert.equal((await api.mutateRoom(db, created.room.id, guest, resign)).receipt.revision, 2);
  assert.equal(
    (await api.listRooms(db, "a")).items.some((item) => item.id === created.room.id),
    false,
  );
});

test("completed feedback3 rooms remain private read-only snapshots without migrating stored games", async () => {
  const { room: created } = await room("shrine");
  const joined = await api.mutateRoom(db, created.id, "b", input("join", 0));
  await api.mutateRoom(
    db,
    created.id,
    "a",
    input("command", 1, {
      command: {
        type: "choose-shrine",
        shrineKind: joined.update!.view.state.shrineDraft!.offers[1][0],
        parity: "odd",
      },
    }),
  );
  await api.mutateRoom(db, created.id, "a", input("resign", 2));
  const oldVersion = "7824f47c0deb0797819833f6641021f87f4aecbd";
  await db
    .prepare("UPDATE haojie_rooms SET engine_version = ?, ruleset = '3.0-feedback3' WHERE id = ?")
    .bind(oldVersion, created.id)
    .run();
  const stored = () =>
    db
      .prepare(
        "SELECT state_json, revision, engine_version, ruleset FROM haojie_rooms WHERE id = ?",
      )
      .bind(created.id)
      .first();
  const before = await stored();
  for (const actor of ["a", "b"]) {
    const result = (await api.getRoom(db, created.id, actor, 2))!;
    assert.equal(result.room.status, "finished");
    assert.equal(result.room.engineVersion, oldVersion);
    assert.equal(result.room.winner, 2);
    assert.equal(result.update?.kind, "snapshot");
    assert.equal(result.update?.view.ruleset, "3.0-feedback4");
    assert.equal(result.update?.view.viewer, actor === "a" ? 1 : 2);
    assert.equal(Boolean(result.update?.view.state.shrineDraft?.choices[1]), actor === "a");
    noPrivate(result);
  }
  assert.equal(await api.getRoom(db, created.id, "a", 3), null);
  await assert.rejects(api.getRoom(db, created.id, "c"), rejection("ROOM_UNAVAILABLE"));
  await assert.rejects(
    api.mutateRoom(db, created.id, "a", input("resign", 3)),
    rejection("ENGINE_MISMATCH"),
  );
  assert.deepEqual(await stored(), before);

  await db
    .prepare("UPDATE haojie_rooms SET status = 'playing' WHERE id = ?")
    .bind(created.id)
    .run();
  assert.equal((await api.getRoom(db, created.id, "a"))!.update, null);
  await assert.rejects(
    api.mutateRoom(db, created.id, "a", input("command", 3, { command: { type: "summon" } })),
    rejection("ENGINE_MISMATCH"),
  );
  await db
    .prepare("UPDATE haojie_rooms SET status = 'finished', ruleset = 'unknown' WHERE id = ?")
    .bind(created.id)
    .run();
  assert.equal((await api.getRoom(db, created.id, "a"))!.update, null);
  await db
    .prepare("UPDATE haojie_rooms SET ruleset = '3.0-feedback3', state_json = '{}' WHERE id = ?")
    .bind(created.id)
    .run();
  assert.equal((await api.getRoom(db, created.id, "a"))!.update, null);
});

test("commands commit once, reject stale or forged actions, and recover a lost receipt", async () => {
  const { room: created } = await room();
  await api.mutateRoom(db, created.id, "b", input("join", 0));
  const command = input("command", 1, { command: { type: "summon" } });
  const results = await Promise.all([
    api.mutateRoom(db, created.id, "a", command),
    api.mutateRoom(db, created.id, "a", command),
  ]);
  assert.deepEqual(
    results.map((result) => result.receipt.revision),
    [2, 2],
  );
  const retry = await api.mutateRoom(db, created.id, "a", command);
  assert.equal(retry.receipt.revision, 2);
  assert.equal(retry.room.revision, 2);
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM haojie_requests WHERE room_id = ? AND kind = 'command'")
    .bind(created.id)
    .first<{ n: number }>();
  assert.equal(count!.n, 1);
  await assert.rejects(
    api.mutateRoom(db, created.id, "a", { ...command, command: { type: "end" } } as MutationInput),
    rejection("REQUEST_REUSED"),
  );
  await assert.rejects(
    api.mutateRoom(db, created.id, "a", input("command", 1, { command: { type: "summon" } })),
    rejection("REVISION_CONFLICT"),
  );
  const before = await api.getRoom(db, created.id, "a");
  await assert.rejects(
    api.mutateRoom(
      db,
      created.id,
      "b",
      input("command", 2, { command: { type: "summon", player: 1 } }),
    ),
    rejection("COMMAND_REJECTED"),
  );
  assert.deepEqual(await api.getRoom(db, created.id, "a"), before);
  const races = await Promise.allSettled(
    [1, 2].map(() =>
      api.mutateRoom(db, created.id, "a", input("command", 2, { command: { type: "summon" } })),
    ),
  );
  assert.equal(races.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await api.getRoom(db, created.id, "a", 2))?.update?.kind, "update");
  assert.equal((await api.getRoom(db, created.id, "a", 1))?.update?.kind, "snapshot");
  await assert.rejects(
    api.mutateRoom(db, created.id, "a", { ...input("resign", 3), engineVersion: "0".repeat(40) }),
    rejection("ENGINE_MISMATCH"),
  );
});

test("independent shrine choices rebase without leaking the unrevealed choice", async () => {
  const { room: created } = await room("shrine");
  const joined = await api.mutateRoom(db, created.id, "b", input("join", 0));
  const offers = joined.update!.view.state.shrineDraft!.offers;
  await api.mutateRoom(
    db,
    created.id,
    "a",
    input("command", 1, {
      command: { type: "choose-shrine", shrineKind: offers[1][0], parity: "odd" },
    }),
  );
  const hidden = (await api.getRoom(db, created.id, "b"))!;
  assert.equal(hidden.update!.view.state.shrineDraft!.choices[1], undefined);
  noPrivate(hidden);
  const done = await api.mutateRoom(
    db,
    created.id,
    "b",
    input("command", 1, {
      command: { type: "choose-shrine", shrineKind: offers[2][0], parity: "even" },
    }),
  );
  assert.equal(done.receipt.revision, 3);
  assert.equal(done.update!.view.state.shrineDraft!.revealed, true);
  assert.equal((await api.getRoom(db, created.id, "a", 1))!.update!.kind, "snapshot");
  const simultaneous = (await room("shrine")).room;
  const initial = await api.mutateRoom(db, simultaneous.id, "b", input("join", 0));
  const choices = initial.update!.view.state.shrineDraft!.offers;
  const both = await Promise.all(
    ["a", "b"].map((actor, index) =>
      api.mutateRoom(
        db,
        simultaneous.id,
        actor,
        input("command", 1, {
          command: {
            type: "choose-shrine",
            shrineKind: choices[(index + 1) as 1 | 2][0],
            parity: "odd",
          },
        }),
      ),
    ),
  );
  assert.deepEqual(both.map((result) => result.receipt.revision).sort(), [2, 3]);
});

test("D1 abort rolls back both receipt and state; cancel only applies before joining", async () => {
  const { room: created } = await room();
  await api.mutateRoom(db, created.id, "b", input("join", 0));
  const before = await api.getRoom(db, created.id, "a");
  await db
    .prepare(
      "CREATE TRIGGER haojie_test_abort BEFORE UPDATE OF state_json ON haojie_rooms BEGIN SELECT RAISE(ABORT, 'injected'); END",
    )
    .run();
  const command = input("command", 1, { command: { type: "summon" } });
  await assert.rejects(api.mutateRoom(db, created.id, "a", command));
  assert.deepEqual(await api.getRoom(db, created.id, "a"), before);
  assert.equal(
    await db
      .prepare("SELECT revision FROM haojie_requests WHERE request_id = ?")
      .bind(command.requestId)
      .first(),
    null,
  );
  await db.prepare("DROP TRIGGER haojie_test_abort").run();
  assert.equal((await api.mutateRoom(db, created.id, "a", command)).receipt.revision, 2);
  const waiting = (await room()).room;
  await assert.rejects(
    api.mutateRoom(db, waiting.id, "b", input("cancel", 0)),
    rejection("ROOM_FORBIDDEN"),
  );
  assert.equal(
    (await api.mutateRoom(db, waiting.id, "a", input("cancel", 0))).room.status,
    "cancelled",
  );
  await assert.rejects(
    api.mutateRoom(db, waiting.id, "b", input("join", 0)),
    rejection("ROOM_UNAVAILABLE"),
  );
});

test("HTTP boundary rejects cross-site, oversized and malformed commands", async () => {
  const request = (body: string, origin = "https://example.test") =>
    new Request("https://example.test/api/haojie/rooms", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body,
    });
  await assert.rejects(
    api.readRoomBody(request("{}", "https://foreign.test")),
    rejection("ORIGIN_REJECTED"),
  );
  await assert.rejects(api.readRoomBody(request("x".repeat(16385))), rejection("BODY_TOO_LARGE"));
  await assert.rejects(api.readRoomBody(request("{")), rejection("INVALID_REQUEST"));
  assert.throws(() =>
    api.parseMutation("command", {
      ...input("command", 0),
      kind: undefined,
      command: { type: "end", rng: 1 },
    }),
  );
  assert.throws(() => api.parseAfter("9007199254740992"));
  assert.equal(api.parseAfter(null), -1);
});

test("emoji bursts stay ordered and idempotent without changing game state or admitting spectators", async () => {
  const { room: created } = await room();
  const makeItems = (count: number) =>
    Array.from({ length: count }, () => ({ id: crypto.randomUUID(), emoji: "😂" as const }));
  await assert.rejects(
    api.sendReactions(db, created.id, "b", makeItems(1)),
    rejection("ROOM_FORBIDDEN"),
  );
  await api.mutateRoom(db, created.id, "b", input("join", 0));
  const before = (await api.getRoom(db, created.id, "a"))!;
  const items = makeItems(8);
  const both = await Promise.all([
    api.sendReactions(db, created.id, "a", items),
    api.sendReactions(db, created.id, "b", makeItems(8)),
  ]);
  assert.equal(Math.max(...both.map((result) => result.reactions.sequence)), 16);
  const replay = await api.sendReactions(db, created.id, "a", items);
  assert.equal(replay.reactions.sequence, 16);
  assert.equal(replay.reactions.items.length, 16);
  assert.deepEqual(
    replay.reactions.items.map((item) => item.sequence),
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
  assert.equal(replay.reactions.items.filter((item) => item.player === 1).length, 8);
  const poll = (await api.getRoom(db, created.id, "b", 1, 0))!;
  assert.equal(poll.room.revision, 1);
  assert.equal(poll.update, null, "emoji-only polls do not transfer or re-run the game snapshot");
  assert.deepEqual(poll.reactions, replay.reactions);
  assert.equal(await api.getRoom(db, created.id, "b", 1, 16), null);
  assert.deepEqual((await api.getRoom(db, created.id, "a"))!.update, before.update);
  await assert.rejects(
    api.sendReactions(db, created.id, "c", makeItems(1)),
    rejection("ROOM_UNAVAILABLE"),
  );
  await assert.rejects(api.sendReactions(db, created.id, "b", items), rejection("REQUEST_REUSED"));
  assert.throws(
    () => api.parseReaction({ items: [{ id: crypto.randomUUID(), emoji: "<script>" }] }),
    rejection("INVALID_REQUEST"),
  );
  assert.throws(
    () => api.parseReaction({ items: [...items, items[0]] }),
    rejection("INVALID_REQUEST"),
  );
  assert.throws(() => api.parseReaction({ items, player: 2 }), rejection("INVALID_REQUEST"));
  for (let i = 0; i < 18; i++) await api.sendReactions(db, created.id, "a", makeItems(8));
  const bounded = (await api.getRoom(db, created.id, "a"))!.reactions!;
  assert.equal(bounded.sequence, 160);
  assert.equal(bounded.items.length, 128);
  assert.equal(bounded.items[0].sequence, 33);
  await api.mutateRoom(db, created.id, "a", input("resign", 1));
  await assert.rejects(
    api.sendReactions(db, created.id, "a", makeItems(1)),
    rejection("ROOM_NOT_PLAYING"),
  );
});
