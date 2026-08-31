import assert from "node:assert/strict";
import test from "node:test";

import { validateCanonicalAnnotationDocument } from "../lib/annotations/invariants.ts";
import {
  AnnotationIntegrityError,
  assertConfirmedAnnotationRemovals,
  hasAnnotationTransition,
  planAnnotatedPostSave,
} from "../lib/annotations/save-plan.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";
const B = "ann_123e4567-e89b-42d3-a456-426614174000";

const active = (annotationId: string) => ({
  annotationId,
  deletedAt: null,
  deletedByUserId: null,
  hiddenAt: null,
  hiddenByUserId: null,
});

test("accepts exactly the confirmed subset of current annotation removals", () => {
  assert.deepEqual(assertConfirmedAnnotationRemovals([A, B], [A], [A]), [A]);
  assert.deepEqual(assertConfirmedAnnotationRemovals([A, B], [], [A]), [A]);
});

test("normalizes duplicate confirmations and rejects unconfirmed malformed or foreign IDs", () => {
  assert.deepEqual(assertConfirmedAnnotationRemovals([A, B], [A], [A, A]), [A]);
  for (const confirmed of [[], ["not-an-annotation"], ["ann_6ba7b810-9dad-41d1-80b4-00c04fd430c8"]]) {
    assert.throws(
      () => assertConfirmedAnnotationRemovals([A, B], [A], confirmed),
      (error: unknown) => error instanceof AnnotationIntegrityError && error.code === "ANNOTATION_INTEGRITY_ERROR",
    );
  }
});

test("validates submitted Markdown against owned IDs while allowing confirmed IDs to be absent", () => {
  const removed = validateCanonicalAnnotationDocument("修改后的普通正文", [A], []);
  assert.equal(removed.ok, true);

  const forged = validateCanonicalAnnotationDocument(`:annotation[伪造]{#${B}}`, [A], [B]);
  assert.equal(forged.ok, false);
  assert.ok(forged.issues.some((issue) => issue.code === "UNKNOWN_ID" && issue.annotationId === B));
});

test("detects every annotation transition across a revision interval including net-zero changes", () => {
  const base = { markdown: `:annotation[A]{#${A}} 正文`, states: [active(A)] };
  const withB = { markdown: `:annotation[A]{#${A}} :annotation[B]{#${B}} 正文`, states: [active(A), active(B)] };
  const backToA = { markdown: `:annotation[A]{#${A}} 正文`, states: [active(A)] };
  assert.equal(hasAnnotationTransition([base, withB, backToA]), true);
});

test("distinguishes ordinary body edits from anchor text or lifecycle changes", () => {
  const base = { markdown: `:annotation[A]{#${A}} 旧正文`, states: [active(A)] };
  assert.equal(hasAnnotationTransition([
    base,
    { markdown: `:annotation[A]{#${A}} 新正文`, states: [active(A)] },
  ]), false);
  assert.equal(hasAnnotationTransition([
    base,
    { markdown: `:annotation[AA]{#${A}} 旧正文`, states: [active(A)] },
  ]), true);
  assert.equal(hasAnnotationTransition([
    base,
    { markdown: base.markdown, states: [{ ...active(A), hiddenAt: new Date(100) }] },
  ]), true);
});

test("plans retained snapshots and post-edit retirement without mutating retained thread payload", () => {
  const at = new Date("2026-08-31T12:00:00.000Z");
  const result = planAnnotatedPostSave({
    baseIds: [A, B],
    submittedMarkdown: `:annotation[内部已修改]{#${B}}`,
    confirmedDeletionIds: [A],
    currentStates: [active(A), active(B)],
    currentImportedReplyStates: [
      { annotationId: A, annotationReplyId: "reply-a", deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null },
      { annotationId: B, annotationReplyId: "reply-b", deletedAt: null, deletedByUserId: null, hiddenAt: null, hiddenByUserId: null },
    ],
    actorUserId: "post-author",
    at,
  });

  assert.deepEqual(result.delta, { retained: [B], removed: [A], unexpected: [] });
  assert.deepEqual(result.retainedStates, [active(B)]);
  assert.deepEqual(result.retainedImportedReplyStates.map((state) => state.annotationReplyId), ["reply-b"]);
  assert.deepEqual(result.retirements.map((retirement) => retirement.annotationId), [A]);
  assert.equal(result.retirements[0]?.annotationId, A);
  assert.equal(result.retirements[0]?.patch.anchorRetiredReason, "POST_EDIT");
});
