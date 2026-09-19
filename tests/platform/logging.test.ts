import assert from "node:assert/strict";
import test from "node:test";

import {
  logServerError,
  logServerRenderError,
  logServerRejection,
  markServerErrorStage,
  serverErrorCode,
} from "../../lib/logging.ts";

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

test("expected rejections keep incident IDs without logging payloads", () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (value?: unknown) => lines.push(String(value));
  let incidentId = "";
  try {
    incidentId = logServerRejection({
      operation: "annotation.create",
      stage: "selection",
      entityId: "post_123",
      userId: "user_456",
      code: "TEXT_MISMATCH",
      selection: {
        blockOrdinal: 12,
        endBlockOrdinal: 12,
        blockTextFrom: 18,
        blockTextTo: 44,
        selectedTextLength: 26,
      },
    });
  } finally {
    console.warn = original;
  }

  assert.match(incidentId, /^[0-9a-f-]{36}$/);
  const record = JSON.parse(lines[0]);
  assert.equal(record.incidentId, incidentId);
  delete record.incidentId;
  assert.deepEqual(record, {
    level: "warn",
    event: "server_operation_rejected",
    operation: "annotation.create",
    stage: "selection",
    entityId: "post_123",
    userId: "user_456",
    code: "TEXT_MISMATCH",
    selection: {
      blockOrdinal: 12,
      endBlockOrdinal: 12,
      blockTextFrom: 18,
      blockTextTo: 44,
      selectedTextLength: 26,
    },
  });
  assert.doesNotMatch(lines[0], /message|stack|markdown|selectionText/i);
});

test("page error logs match the installed framework digest without exposing error text", async () => {
  const { sanitizeErrorForClient } = await import(
    new URL("../../node_modules/vinext/dist/server/app-rsc-errors.js", import.meta.url).href
  );
  const error = new Error("secret post user@example.com");
  const lines: string[] = [];
  const original = console.error;
  console.error = (value?: unknown) => {
    lines.push(String(value));
  };
  try {
    logServerRenderError({ operation: "post.page", stage: "read", entityId: "p", error });
  } finally {
    console.error = original;
  }
  assert.equal(
    JSON.parse(lines[0]).renderDigest,
    sanitizeErrorForClient(error, "production").digest,
  );
  assert.doesNotMatch(lines[0], /secret|example\.com|stack|message/);
});
