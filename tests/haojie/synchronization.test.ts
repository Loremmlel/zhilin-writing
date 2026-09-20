import assert from "node:assert/strict";
import { test } from "node:test";
import { RoomClient, acceptRoomSnapshot } from "../../lib/haojie/client.ts";
import { HAOJIE_ENGINE_VERSION, type RoomSnapshot } from "../../lib/haojie/contracts.ts";

const initial: RoomSnapshot = {
  room: {
    id: "00000000-0000-4000-8000-000000000001",
    mode: "classic",
    status: "playing",
    revision: 1,
    player1: { id: "a", name: "甲" },
    player2: { id: "b", name: "乙" },
    viewer: 1,
    winner: null,
    endReason: null,
    updatedAt: 0,
    engineVersion: HAOJIE_ENGINE_VERSION,
  },
  update: {
    matchId: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    kind: "snapshot",
    view: {
      viewVersion: 1,
      ruleset: "3.0-feedback3",
      viewer: 1,
      state: {
        version: 2,
        serial: 1,
        ply: 1,
        active: 1,
        phase: "summon",
        summonSlots: 2,
        turns: { 1: 1, 2: 0 },
        bases: { 1: 300, 2: 300 },
        baseEffects: { 1: [], 2: [] },
        heads: { 1: 0, 2: 0 },
        hands: { 1: [], 2: [] },
        bonus: { 1: 0, 2: 0 },
        deployRows: { 1: [1, 2, 3, 4, 5, 6, 7, 8], 2: [6, 7, 8, 9, 10, 11, 12, 13] },
        units: [],
        pending: [],
        deaths: [],
        hazards: [],
        siphons: [],
        iceMarks: [],
        log: [],
        events: [],
      },
    },
  },
};
const at = (revision: number): RoomSnapshot => ({
  room: { ...initial.room, revision },
  update: { ...initial.update!, revision, kind: "update" },
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("snapshots ignore stale responses and suppress incomplete animations across revisions", () => {
  const current = at(3);
  assert.equal(acceptRoomSnapshot(current, at(2)), current);
  assert.equal(acceptRoomSnapshot(current, at(4)).update!.kind, "update");
  assert.equal(acceptRoomSnapshot(current, at(6)).update!.kind, "snapshot");
  assert.equal(acceptRoomSnapshot(current, at(3), true).update!.kind, "snapshot");
});

test("polling is serial, continues on the player's turn, slows in background and stops at the end", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const reads: ((value: Response) => void)[] = [];
  const client = new RoomClient(initial, async () => new Promise((resolve) => reads.push(resolve)));
  t.after(() => client.stop());
  client.start();
  client.refresh();
  client.refresh();
  assert.equal(reads.length, 1);
  reads[0](Response.json(initial));
  await flush();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(reads.length, 2);
  reads[1](new Response(null, { status: 204 }));
  await flush();
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(reads.length, 3);
  client.setVisible(false);
  reads[2](new Response(null, { status: 204 }));
  await flush();
  t.mock.timers.tick(9999);
  await flush();
  assert.equal(reads.length, 3);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(reads.length, 4);
  reads[3](Response.json({ ...at(2), room: { ...at(2).room, status: "finished", winner: 1 } }));
  await flush();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(reads.length, 4);
});

test("lost receipt keeps the operation locked and retries the identical request after newer polls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const bodies: string[] = [];
  let current = initial;
  const client = new RoomClient(initial, async (_url, init) => {
    if (init?.method !== "POST") return Response.json(current);
    bodies.push(String(init.body));
    if (bodies.length === 1) {
      current = at(3);
      throw new TypeError("lost response after commit");
    }
    return Response.json({ ...at(2), receipt: { ok: true, revision: 2 } });
  });
  t.after(() => client.stop());
  client.start();
  await flush();
  const ack = client.submit({ kind: "command", baseRevision: 1, command: { type: "summon" } });
  await flush();
  assert.equal(client.getSnapshot().pending, true);
  assert.equal(client.getSnapshot().connection, "connecting");
  client.refresh();
  await flush();
  assert.equal(client.getSnapshot().snapshot.room.revision, 3);
  assert.equal(client.getSnapshot().pending, true, "a poll cannot acknowledge our write");
  assert.equal(
    (await client.submit({ kind: "command", baseRevision: 3, command: { type: "end" } })).ok,
    false,
  );
  t.mock.timers.tick(1200);
  await flush();
  assert.deepEqual(await ack, { ok: true, revision: 2 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(client.getSnapshot().snapshot.room.revision, 3);
  assert.equal(client.getSnapshot().pending, false);
  assert.equal(client.getSnapshot().connection, "connected");
});

test("conflicts restore a fresh snapshot; authentication failure stops polling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let authenticated = true;
  let reads = 0;
  const client = new RoomClient(initial, async (_url, init) => {
    if (init?.method === "POST")
      return Response.json(
        { error: { code: "REVISION_CONFLICT", message: "局面已变化" }, snapshot: at(4) },
        { status: 409 },
      );
    reads++;
    return authenticated
      ? Response.json(initial)
      : Response.json({ error: { code: "AUTH_EXPIRED", message: "请重新登录" } }, { status: 401 });
  });
  t.after(() => client.stop());
  client.start();
  await flush();
  const receipt = await client.submit({
    kind: "command",
    baseRevision: 1,
    command: { type: "summon" },
  });
  assert.equal(receipt.ok, false);
  assert.equal(client.getSnapshot().snapshot.room.revision, 4);
  assert.equal(client.getSnapshot().snapshot.update!.kind, "snapshot");
  authenticated = false;
  client.refresh();
  await flush();
  assert.equal(client.getSnapshot().fatal, true);
  const before = reads;
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(reads, before);
});

test("emoji bursts queue every click, release smoothly and deduplicate poll/receipt races", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const items: import("../../lib/haojie/reactions.ts").RoomReaction[] = [];
  const sent: { id: string; emoji: "😂" }[][] = [];
  const client = new RoomClient(initial, async (_url, init) => {
    if (init?.method === "POST") {
      const batch = JSON.parse(String(init.body)).items;
      sent.push(batch);
      items.push(
        ...batch.map((item: { id: string; emoji: "😂" }, index: number) => ({
          ...item,
          player: 1 as const,
          sequence: items.length + index + 1,
          createdAt: Date.now(),
        })),
      );
      return Response.json({ reactions: { sequence: items.length, items } });
    }
    return Response.json({ ...initial, reactions: { sequence: items.length, items } });
  });
  t.after(() => client.stop());
  client.start();
  await flush();
  for (let i = 0; i < 20; i++) client.sendReaction("😂");
  assert.equal(client.getSnapshot().reactionPending, 20, "no click cooldown or dropped clicks");
  assert.equal(client.getSnapshot().pending, false, "emoji queue must not lock the board");
  t.mock.timers.tick(120);
  await flush();
  assert.equal(sent[0].length, 8);
  assert.equal(
    client.getSnapshot().reactions.length,
    1,
    "a received burst must not spawn all at once",
  );
  assert.equal(client.getSnapshot().reactionPending, 12);
  t.mock.timers.tick(149);
  assert.equal(client.getSnapshot().reactions.length, 1);
  t.mock.timers.tick(1);
  assert.equal(client.getSnapshot().reactions.length, 2);
  client.refresh();
  await flush();
  const board = client.getSnapshot().snapshot.update;
  for (let i = 0; i < 50; i++) {
    t.mock.timers.tick(150);
    await flush();
  }
  assert.deepEqual(
    sent.map((batch) => batch.length),
    [8, 8, 4],
  );
  assert.equal(client.getSnapshot().reactionPending, 0);
  assert.equal(client.getSnapshot().reactions.length, 20);
  assert.equal(new Set(client.getSnapshot().reactions.map((item) => item.id)).size, 20);
  assert.equal(
    client.getSnapshot().snapshot.update,
    board,
    "reaction-only polls preserve the rendered board",
  );
  const resumed = new RoomClient({ ...initial, reactions: { sequence: 20, items } }, async () =>
    Response.json({ ...initial, reactions: { sequence: 20, items } }),
  );
  resumed.start();
  await flush();
  assert.equal(resumed.getSnapshot().reactions.length, 0, "refreshing does not replay history");
  resumed.stop();
});

test("emoji failure preserves its batch for explicit retry and does not disconnect the game", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const bodies: string[] = [];
  const client = new RoomClient(initial, async (_url, init) => {
    if (init?.method !== "POST") return Response.json(initial);
    bodies.push(String(init.body));
    if (bodies.length === 1) throw new TypeError("response lost");
    const item = JSON.parse(String(init.body)).items[0];
    return Response.json({
      reactions: {
        sequence: 1,
        items: [{ ...item, sequence: 1, player: 1, createdAt: Date.now() }],
      },
    });
  });
  t.after(() => client.stop());
  client.start();
  await flush();
  client.sendReaction("😂");
  t.mock.timers.tick(120);
  await flush();
  assert.equal(client.getSnapshot().connection, "connected");
  assert.equal(client.getSnapshot().pending, false);
  assert.equal(client.getSnapshot().reactionPending, 1);
  assert.equal(client.getSnapshot().reactionError?.code, "REACTION_UNCERTAIN");
  client.retryReactions();
  await flush();
  assert.equal(bodies[0], bodies[1]);
  assert.equal(client.getSnapshot().reactionPending, 0);
  assert.equal(client.getSnapshot().reactionError, null);
});

test("parabolic emoji falls remain narrow and inside mobile and desktop viewports", async () => {
  const { reactionFlight } = await import("../../lib/haojie/reactions.ts");
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1440, 900],
    [2560, 1440],
  ]) {
    for (let i = 0; i < 100; i++) {
      const flight = reactionFlight(String(i), width, height);
      assert.ok(flight.distance / flight.drift ** 2 >= 0.025 - 1e-10);
      assert.ok(flight.start >= 8 && flight.start + 64 <= width - 8);
      assert.ok(flight.start + flight.drift >= 8 && flight.start + flight.drift + 64 <= width - 8);
      assert.ok(Math.abs(flight.drift) <= 180);
      assert.deepEqual(
        reactionFlight(String(i), width, height),
        flight,
        "same event has stable randomness",
      );
    }
  }
});
