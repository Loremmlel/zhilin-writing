import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAnnotationDelta,
  planAnnotationRetirement,
} from "../lib/annotations/save-plan.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";
const B = "ann_123e4567-e89b-42d3-a456-426614174000";
const C = "ann_6ba7b810-9dad-41d1-80b4-00c04fd430c8";

test("computes retained removed and unexpected annotation IDs deterministically", () => {
  assert.deepEqual(computeAnnotationDelta([B, A], [C, B]), {
    retained: [B],
    removed: [A],
    unexpected: [C],
  });
});

test("normalizes duplicate delta inputs without hiding membership changes", () => {
  assert.deepEqual(computeAnnotationDelta([A, A, B], [B, B]), {
    retained: [B],
    removed: [A],
    unexpected: [],
  });
});

test("plans post-edit retirement without changing author-deletion state", () => {
  const at = new Date("2026-08-31T10:00:00.000Z");
  assert.deepEqual(planAnnotationRetirement([B, A], "post-author", at, "POST_EDIT"), [
    {
      annotationId: B,
      patch: {
        anchorRetiredAt: at,
        anchorRetiredByUserId: "post-author",
        anchorRetiredReason: "POST_EDIT",
      },
    },
    {
      annotationId: A,
      patch: {
        anchorRetiredAt: at,
        anchorRetiredByUserId: "post-author",
        anchorRetiredReason: "POST_EDIT",
      },
    },
  ]);
});
