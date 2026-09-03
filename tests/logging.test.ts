import assert from "node:assert/strict";
import test from "node:test";

import { logServerError, serverErrorCode } from "../lib/logging.ts";

test("production error logging keeps operational IDs and redacts payload details", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (value?: unknown) => {
    lines.push(String(value));
  };
  try {
    const error = Object.assign(new Error("private post Markdown user@example.com"), {
      code: "R2_DELETE_FAILED",
    });
    logServerError({
      operation: "asset.gc.delete",
      entityId: "asset_123",
      userId: "user_456",
      error,
    });
  } finally {
    console.error = original;
  }

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.match(record.requestId, /^[0-9a-f-]{36}$/);
  delete record.requestId;
  assert.deepEqual(record, {
    level: "error",
    event: "server_operation_failed",
    operation: "asset.gc.delete",
    entityId: "asset_123",
    userId: "user_456",
    errorCode: "R2_DELETE_FAILED",
  });
  assert.doesNotMatch(lines[0], /private post|example\.com|stack|message/i);
});

test("unknown and unsafe error codes fall back without serializing the error", () => {
  assert.equal(
    serverErrorCode(Object.assign(new Error("secret"), { code: "bad code" }), "POST_SAVE_FAILED"),
    "POST_SAVE_FAILED",
  );
  assert.equal(serverErrorCode(null), "INTERNAL_ERROR");
});
