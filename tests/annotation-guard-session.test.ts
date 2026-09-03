import assert from "node:assert/strict";
import test from "node:test";

import { redo, history, undo } from "@milkdown/kit/prose/history";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";

import { createAnnotationGuardSession } from "../lib/editor/annotation-session.ts";
import { annotationMark, annotationTestSchema, editorState } from "./annotation-test-schema.ts";

function applyAccepted(
  session: ReturnType<typeof createAnnotationGuardSession>,
  state: EditorState,
  transaction: Transaction,
) {
  const next = state.apply(transaction);
  session.acceptTransaction(state, transaction, next);
  return next;
}

function historyTransaction(state: EditorState, command: typeof undo | typeof redo) {
  let transaction: Transaction | undefined;
  assert.equal(
    command(state, (next) => {
      transaction = next;
    }),
    true,
  );
  assert.ok(transaction);
  return transaction;
}

test("confirm applies one composite history operation while cancel leaves the document untouched", () => {
  const pending = [];
  const session = createAnnotationGuardSession({
    baseAnnotationIds: ["a"],
    onPendingImpact: (value) => pending.push(value),
  });
  const initial = editorState([{ text: "AAA", marks: [annotationMark("a")] }], { from: 1, to: 4 }, [
    history(),
  ]);

  const first = session.inspectTransaction(initial, initial.tr.deleteSelection());
  assert.equal(first.kind, "BLOCK");
  assert.equal(pending.length, 1);
  session.cancelPendingAnnotationImpact(first.pending.token);
  assert.equal(initial.doc.textContent, "AAA");

  const second = session.inspectTransaction(initial, initial.tr.deleteSelection());
  assert.equal(second.kind, "BLOCK");
  const confirmed = session.confirmPendingAnnotationImpact(second.pending.token, initial);
  assert.equal(confirmed.kind, "APPLY");
  const edited = applyAccepted(session, initial, confirmed.transaction);
  assert.equal(edited.doc.textContent, "");
  assert.deepEqual(session.confirmedAnnotationDeletionIds(edited.doc), ["a"]);

  const undoTransaction = historyTransaction(edited, undo);
  assert.equal(session.inspectTransaction(edited, undoTransaction).kind, "ALLOW");
  const restored = applyAccepted(session, edited, undoTransaction);
  assert.equal(restored.doc.textContent, "AAA");
  assert.equal(restored.doc.rangeHasMark(1, 4, annotationTestSchema.marks.annotation), true);
  assert.deepEqual(session.confirmedAnnotationDeletionIds(restored.doc), []);

  const redoTransaction = historyTransaction(restored, redo);
  assert.equal(session.inspectTransaction(restored, redoTransaction).kind, "ALLOW_CONFIRMED");
  const redone = applyAccepted(session, restored, redoTransaction);
  assert.equal(redone.doc.textContent, "");
  assert.deepEqual(session.confirmedAnnotationDeletionIds(redone.doc), ["a"]);
  assert.equal(pending.length, 2, "redo must not emit a second dialog");
});

test("one confirmation covers multiple annotations and stale state is never replayed", () => {
  const session = createAnnotationGuardSession({ baseAnnotationIds: ["a", "b"] });
  const state = editorState(
    [
      { text: "AAA", marks: [annotationMark("a")] },
      { text: " gap " },
      { text: "BBB", marks: [annotationMark("b")] },
    ],
    { from: 1, to: 12 },
  );
  const decision = session.inspectTransaction(state, state.tr.insertText("替换"));
  assert.equal(decision.kind, "BLOCK");
  assert.deepEqual(decision.pending.affectedAnnotationIds, ["a", "b"]);

  const moved = applyAccepted(
    session,
    state,
    state.tr.setSelection(TextSelection.create(state.doc, 2)),
  );
  const result = session.confirmPendingAnnotationImpact(decision.pending.token, moved);
  assert.deepEqual(result, { kind: "STALE", message: "正文已经变化，请重新执行刚才的操作" });
  assert.equal(moved.doc.textContent, "AAA gap BBB");
});

test("discard clears pending impact confirmed removals and redo authorization", () => {
  const session = createAnnotationGuardSession({
    baseAnnotationIds: ["a"],
    initialConfirmedAnnotationDeletionIds: ["a"],
  });
  const state = editorState([{ text: "正文" }]);
  assert.deepEqual(session.confirmedAnnotationDeletionIds(state.doc), ["a"]);
  session.discard();
  assert.deepEqual(session.confirmedAnnotationDeletionIds(state.doc), []);
  assert.equal(session.pendingImpact(), null);
});
