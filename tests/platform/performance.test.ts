import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  measuredDatabase,
  measuredBucket,
  requestPerformance,
  savePerformance,
  observeResponseBody,
} from "../../lib/performance/server.ts";
import { performanceRoute, sanitizeClientRecord } from "../../lib/performance/shared.ts";

test("response probe preserves streamed bytes, cancellation and errors without reading ahead", async () => {
  let reads = 0;
  const outcomes: string[] = [];
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array([42]));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const observed = observeResponseBody(body, (outcome) => outcomes.push(outcome));
  await Promise.resolve();
  assert.equal(reads, 0);
  assert.deepEqual([...new Uint8Array(await new Response(observed).arrayBuffer())], [42]);
  assert.deepEqual(outcomes, ["complete"]);
  let cancelled = false;
  await observeResponseBody(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    (outcome) => outcomes.push(outcome),
  ).cancel();
  assert.equal(cancelled, true);
  assert.equal(outcomes.at(-1), "cancelled");
  const broken = observeResponseBody(
    new ReadableStream({
      pull() {
        throw new Error("stream failed");
      },
    }),
    (outcome) => outcomes.push(outcome),
  );
  await assert.rejects(new Response(broken).text(), /stream failed/);
  assert.equal(outcomes.at(-1), "error");
});

test("performance ingestion keeps only bounded numeric metrics and safe route shapes", () => {
  const record = sanitizeClientRecord({
    kind: "resource",
    route: "/posts/private-title/edit",
    durationMs: 12.34,
    dbMs: Infinity,
    status: -1,
    body: "secret",
    cookie: "secret",
    requestId: "secret",
  });
  assert.deepEqual(record, { kind: "resource", route: "/posts/:id/edit", durationMs: 12.3 });
  assert.equal(performanceRoute("/secret@example.com"), "/other");
  assert.equal(performanceRoute("/.rsc"), "/");
  assert.equal(performanceRoute("/notifications.rsc"), "/notifications");
  assert.equal(performanceRoute("/posts/new.rsc"), "/posts/new");
  assert.equal(performanceRoute("/posts/private-id.rsc"), "/posts/:id");
  assert.equal(performanceRoute("/posts/private-id/edit.rsc"), "/posts/:id/edit");
  assert.equal(sanitizeClientRecord({ kind: "secret" }), null);
});

test("D1 and R2 probes preserve results, failures and batch bindings, and isolate concurrent requests", async () => {
  const original = {
    bind() {
      return this;
    },
    async first() {
      await Promise.resolve();
      return 42;
    },
    async run() {
      throw new Error("expected");
    },
  };
  const db = {
    prepare() {
      return original;
    },
    async batch(items: unknown[]) {
      assert.equal(items[0], original);
      assert.equal(items[1], original);
      return ["batch-result"];
    },
  } as unknown as D1Database;
  const contexts = [1, 2].map((n) => ({
    requestId: String(n),
    dbMs: 0,
    dbCount: 0,
    dbTrips: 0,
    r2Ms: 0,
    r2Count: 0,
  }));
  await Promise.all(
    contexts.map((context) =>
      requestPerformance.run(context, async () => {
        const measured = measuredDatabase(db);
        assert.equal(await measured.prepare("private SQL").bind("private value").first(), 42);
        assert.deepEqual(
          await measured.batch([measured.prepare("SQL").bind(1), measured.prepare("SQL").bind(2)]),
          ["batch-result"],
        );
        await assert.rejects(measured.prepare("SQL").run(), /expected/);
        const bucket = measuredBucket({
          async get() {
            return "object";
          },
        } as unknown as R2Bucket);
        assert.equal(await bucket.get("private-key"), "object");
      }),
    ),
  );
  for (const context of contexts) {
    assert.equal(context.dbCount, 4);
    assert.equal(context.dbTrips, 3);
    assert.equal(context.r2Count, 1);
    assert.ok(context.dbMs >= 0);
  }
  assert.equal(measuredDatabase(db), db);
});

test("performance storage is capped across batches and keeps the newest records", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync(new URL("../../drizzle/0010_performance_logs.sql", import.meta.url), "utf8"),
    );
    const insert = db.prepare(
      "INSERT INTO performance_logs (created_at, source, request_id, record) VALUES (0, 'client', ?, '{}')",
    );
    db.exec("BEGIN");
    for (let n = 0; n < 5100; n++) insert.run(String(n));
    db.exec("COMMIT");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM performance_logs").get()?.n, 5000);
    assert.equal(
      db.prepare("SELECT request_id FROM performance_logs ORDER BY id LIMIT 1").get()?.request_id,
      "100",
    );
  } finally {
    db.close();
  }
});

test("a failed telemetry write never fails or retries a business request", async () => {
  let calls = 0;
  const error = console.error;
  console.error = () => {};
  try {
    await savePerformance(
      {
        prepare() {
          return {
            bind() {
              return {};
            },
          };
        },
        async batch() {
          calls++;
          throw new Error("unavailable");
        },
      } as unknown as D1Database,
      "server",
      [{ requestId: "id" }],
    );
    assert.equal(calls, 1);
  } finally {
    console.error = error;
  }
});
