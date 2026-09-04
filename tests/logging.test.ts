import assert from "node:assert/strict";
import test from "node:test";

import { logServerError, markServerErrorStage, serverErrorCode } from "../lib/logging.ts";

test("production error logging keeps operational IDs and redacts payload details", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (value?: unknown) => {
    lines.push(String(value));
  };
  try {
    const cause = Object.assign(
      new Error("D1_ERROR: FOREIGN KEY constraint failed private post user@example.com"),
      { code: "D1_ERROR" },
    );
    const error = Object.assign(new Error("private post Markdown user@example.com", { cause }), {
      code: "R2_DELETE_FAILED",
    });
    const incidentId = logServerError({
      operation: "asset.gc.delete",
      entityId: "asset_123",
      userId: "user_456",
      error,
      errorCode: "ASSET_GC_FAILED",
    });
    assert.match(incidentId, /^[0-9a-f-]{36}$/);
  } finally {
    console.error = original;
  }

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.match(record.incidentId, /^[0-9a-f-]{36}$/);
  delete record.incidentId;
  assert.deepEqual(record, {
    level: "error",
    event: "server_operation_failed",
    operation: "asset.gc.delete",
    entityId: "asset_123",
    userId: "user_456",
    operationCode: "ASSET_GC_FAILED",
    errorCode: "R2_DELETE_FAILED",
    errorName: "Error",
    reason: "FOREIGN_KEY_CONSTRAINT",
    causeErrorCode: "D1_ERROR",
    causeErrorName: "Error",
  });
  assert.doesNotMatch(lines[0], /private post|example\.com|constraint failed|stack|message/i);
});

test("unknown and unsafe error codes fall back without serializing the error", () => {
  assert.equal(
    serverErrorCode(Object.assign(new Error("secret"), { code: "bad code" }), "POST_SAVE_FAILED"),
    "POST_SAVE_FAILED",
  );
  assert.equal(serverErrorCode(null), "INTERNAL_ERROR");
});

test("unsafe diagnostic tokens are redacted without hiding the operation fallback", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (value?: unknown) => lines.push(String(value));
  try {
    const error = Object.assign(new Error("secret"), {
      code: "bad code",
      name: "Bad Error Name",
      reason: "private post markdown",
      stage: "bad stage value",
    });
    logServerError({ operation: "post.update", error, errorCode: "POST_UPDATE_FAILED" });
  } finally {
    console.error = original;
  }

  const record = JSON.parse(lines[0]);
  assert.equal(record.operationCode, "POST_UPDATE_FAILED");
  assert.equal(record.errorCode, "INTERNAL_ERROR");
  assert.equal(record.errorName, "REDACTED");
  assert.equal(record.stage, "REDACTED");
  assert.equal(record.reason, "UNCLASSIFIED");
  assert.doesNotMatch(lines[0], /secret|bad code|bad stage value|private post markdown/i);
});

test("trusted diagnostic reasons identify the failed invariant", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (value?: unknown) => lines.push(String(value));
  try {
    const error = Object.assign(new Error("private markdown"), {
      code: "ANNOTATION_DOCUMENT_INVALID",
      reason: "CURRENT_DUPLICATE",
    });
    logServerError({ operation: "annotation.delete", error });
  } finally {
    console.error = original;
  }

  const record = JSON.parse(lines[0]);
  assert.equal(record.errorCode, "ANNOTATION_DOCUMENT_INVALID");
  assert.equal(record.reason, "CURRENT_DUPLICATE");
  assert.doesNotMatch(lines[0], /private markdown/i);
});

test("the first service stage survives outer error boundaries", () => {
  const error = new Error("secret");
  assert.equal(markServerErrorStage(error, "commit"), error);
  assert.equal(markServerErrorStage(error, "action"), error);
  assert.equal((error as Error & { stage: string }).stage, "commit");
  assert.equal(Object.keys(error).includes("stage"), false);
});
