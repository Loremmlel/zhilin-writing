import assert from "node:assert/strict";
import test from "node:test";

import { AnnotationIntegrityError, planAnnotatedPostSave } from "../lib/annotations/save-plan.ts";
import { assertOrdinaryPostMarkdown } from "../lib/annotations/policy.ts";
import { availableConflictChoices, chooseConflictResolution } from "../lib/editor/conflict.ts";
import { inspectAnnotationTransaction } from "../lib/editor/annotation-guard.ts";
import { scanAnnotationRanges } from "../lib/editor/annotation-ranges.ts";
import { createAnnotationGuardSession } from "../lib/editor/annotation-session.ts";
import { annotationMark, editorState } from "./annotation-test-schema.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";

const activeState = {
  annotationId: A,
  deletedAt: null,
  deletedByUserId: null,
  hiddenAt: null,
  hiddenByUserId: null,
};

function savePlan(markdown: string, confirmedDeletionIds: string[]) {
  return planAnnotatedPostSave({
    baseIds: [A],
    submittedMarkdown: markdown,
    confirmedDeletionIds,
    currentStates: [activeState],
    currentImportedReplyStates: [],
    actorUserId: "post-author",
    at: new Date("2026-09-01T00:00:00.000Z"),
  });
}

test("an internal annotated edit remains silent and retains the same server anchor", () => {
  const state = editorState([{ text: "我喜欢你", marks: [annotationMark(A)] }], { from: 2 });
  const transaction = state.tr.insertText("非常");

  assert.deepEqual(inspectAnnotationTransaction(state.doc, transaction), { kind: "SAFE" });
  assert.deepEqual(scanAnnotationRanges(transaction.doc).map(({ annotationId, text }) => ({ annotationId, text })), [{
    annotationId: A,
    text: "我非常喜欢你",
  }]);
  assert.deepEqual(savePlan(`:annotation[我非常喜欢你]{#${A}}`, []).delta, {
    retained: [A],
    removed: [],
    unexpected: [],
  });
});

test("endpoint loss requires one local confirmation before the server retirement plan", () => {
  const session = createAnnotationGuardSession({ baseAnnotationIds: [A] });
  const state = editorState([{ text: "我喜欢你", marks: [annotationMark(A)] }], { from: 1, to: 2 });
  const decision = session.inspectTransaction(state, state.tr.deleteSelection());
  assert.equal(decision.kind, "BLOCK");
  assert.deepEqual(decision.pending.affectedAnnotationIds, [A]);

  const confirmation = session.confirmPendingAnnotationImpact(decision.pending.token, state);
  assert.equal(confirmation.kind, "APPLY");
  const edited = state.apply(confirmation.transaction);
  assert.equal(edited.doc.textContent, "喜欢你");
  assert.deepEqual(scanAnnotationRanges(edited.doc), []);
  assert.deepEqual(session.confirmedAnnotationDeletionIds(edited.doc), [A]);

  assert.throws(
    () => savePlan("喜欢你", []),
    (error: unknown) => error instanceof AnnotationIntegrityError && error.code === "ANNOTATION_INTEGRITY_ERROR",
  );
  const confirmed = savePlan("喜欢你", session.confirmedAnnotationDeletionIds(edited.doc));
  assert.deepEqual(confirmed.delta, { retained: [], removed: [A], unexpected: [] });
  assert.equal(confirmed.retirements[0]?.patch.anchorRetiredReason, "POST_EDIT");
});

test("annotation conflicts preserve the local choice and never offer force overwrite", () => {
  const local = {
    title: "本地标题",
    markdown: "本地修改",
    tags: "随笔",
    attachmentIds: ["asset-local"],
    baseRevisionId: "revision-1",
  };
  const online = {
    revisionId: "revision-2",
    title: "线上标题",
    markdown: `:annotation[线上新批注]{#${A}}`,
    tags: "线上",
    attachmentIds: [],
    annotationStateChanged: true,
    forceOverwriteAllowed: false,
  };

  assert.deepEqual(availableConflictChoices(online), ["online", "manual"]);
  assert.deepEqual(chooseConflictResolution("manual", local, online), {
    mode: "manual",
    ...local,
    overwriteBaseRevisionId: null,
    conflictOpen: false,
    saveBlocked: true,
  });
  assert.throws(() => chooseConflictResolution("overwrite", local, online), /批注状态/);
});

test("ordinary unannotated editing keeps the original create-path validation", () => {
  const markdown = "普通 **正文**";
  assert.equal(assertOrdinaryPostMarkdown(markdown), markdown);
  const state = editorState([{ text: "普通正文" }], { from: 3 });
  assert.deepEqual(inspectAnnotationTransaction(state.doc, state.tr.insertText("继续")), { kind: "SAFE" });
});
