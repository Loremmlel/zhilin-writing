import { requestPerformance } from "./context.ts";
export { requestPerformance } from "./context.ts";

// Observe consumption without cloning or buffering uploads/downloads or RSC streams.
export function observeResponseBody(
  body: ReadableStream<Uint8Array>,
  finish: (outcome: string) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const context = requestPerformance.getStore();
  let finished = false;
  const end = (outcome: string) => {
    if (!finished) {
      finished = true;
      finish(outcome);
    }
  };
  return new ReadableStream(
    {
      async pull(controller) {
        try {
          const { done, value } = await requestPerformance.run(context!, () => reader.read());
          if (done) {
            controller.close();
            end("complete");
          } else controller.enqueue(value);
        } catch (error) {
          controller.error(error);
          end("error");
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          end("cancelled");
        }
      },
    },
    { highWaterMark: 0 },
  );
}
import { logServerError } from "../logging.ts";

export function measuredDatabase(db: D1Database): D1Database {
  const context = requestPerformance.getStore();
  if (!context) return db;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const statement = (target: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(target, {
      get(target, key) {
        if (key === "bind") return (...args: unknown[]) => statement(target.bind(...args));
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (!["all", "first", "raw", "run"].includes(String(key))) return value.bind(target);
        return async (...args: unknown[]) => {
          const started = performance.now();
          context.dbCount++;
          try {
            return await value.apply(target, args);
          } finally {
            context.dbMs += performance.now() - started;
          }
        };
      },
    });
    originals.set(proxy, target);
    return proxy;
  };
  return new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => statement(target.prepare(sql));
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const started = performance.now();
          context.dbCount += statements.length;
          try {
            return await target.batch(statements.map((item) => originals.get(item) ?? item));
          } finally {
            context.dbMs += performance.now() - started;
          }
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function savePerformance(
  db: D1Database,
  source: "server" | "client",
  records: Record<string, unknown>[],
) {
  if (!records.length) return;
  try {
    await db.batch(
      records.map((record) =>
        db
          .prepare(
            "INSERT INTO performance_logs (created_at, source, request_id, record) VALUES (?, ?, ?, ?)",
          )
          .bind(
            Date.now(),
            source,
            typeof record.requestId === "string" ? record.requestId : null,
            JSON.stringify(record),
          ),
      ),
    );
  } catch (error) {
    // Logging must never change the response or retry a business operation.
    logServerError({
      operation: "performance.persist",
      error,
      errorCode: "PERFORMANCE_LOG_FAILED",
    });
  }
}

export function measuredBucket(bucket: R2Bucket): R2Bucket {
  const context = requestPerformance.getStore();
  if (!context) return bucket;
  return new Proxy(bucket, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (!["get", "head", "put", "delete", "list"].includes(String(key)))
        return value.bind(target);
      return async (...args: unknown[]) => {
        const started = performance.now();
        context.r2Count++;
        try {
          return await value.apply(target, args);
        } finally {
          context.r2Ms += performance.now() - started;
        }
      };
    },
  });
}
