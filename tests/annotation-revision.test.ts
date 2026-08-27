import assert from "node:assert/strict";
import test from "node:test";

import { planAnnotationRestore, type AnnotationStateSnapshot } from "../lib/revisions/policy.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";
const B = "ann_123e4567-e89b-42d3-a456-426614174000";
const active = (annotationId: string): AnnotationStateSnapshot => ({ annotationId, deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null });

test("restoring v2 from v3 retains A and exits B without changing thread history", () => {
  const result = planAnnotationRestore({
    currentMarkdown: `:annotation[A]{#${A}} + :annotation[B]{#${B}}`,
    currentAnchorIds: [A, B],
    currentStates: [active(A), active(B)],
    sourceMarkdown: `:annotation[A]{#${A}}`,
    sourceStates: [active(A)],
  });
  assert.deepEqual(result.sourceAnchorIds, [A]);
  assert.deepEqual(result.exitingAnnotationIds, [B]);
  assert.deepEqual(result.restoredStates, [active(A)]);
});

test("pre-V5 revisions naturally restore an empty annotation snapshot", () => {
  const result = planAnnotationRestore({
    currentMarkdown: `:annotation[A]{#${A}}`,
    currentAnchorIds: [A],
    currentStates: [active(A)],
    sourceMarkdown: "旧正文",
    sourceStates: [],
  });
  assert.deepEqual(result.sourceAnchorIds, []);
  assert.deepEqual(result.exitingAnnotationIds, [A]);
});

test("restore rejects orphan marks, orphan rows, and inconsistent current state", () => {
  const base = {
    currentMarkdown: `:annotation[A]{#${A}}`, currentAnchorIds: [A], currentStates: [active(A)],
    sourceMarkdown: `:annotation[A]{#${A}}`, sourceStates: [active(A)],
  };
  assert.throws(() => planAnnotationRestore({ ...base, sourceStates: [] }), /历史版本.*不一致/);
  assert.throws(() => planAnnotationRestore({ ...base, sourceMarkdown: "无批注" }), /历史版本.*不一致/);
  assert.throws(() => planAnnotationRestore({ ...base, currentAnchorIds: [] }), /当前正文.*不一致/);
});
