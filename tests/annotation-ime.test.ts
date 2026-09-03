import assert from "node:assert/strict";
import test from "node:test";

import { history, redo, undo } from "@milkdown/kit/prose/history";
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

test("ordinary internal IME composition stays quiet and undo restores its text", () => {
  const emitted = [];
  const session = createAnnotationGuardSession({
    baseAnnotationIds: ["a"],
    onPendingImpact: (pending) => emitted.push(pending),
  });
  let state = editorState([{ text: "我喜欢你", marks: [annotationMark("a")] }], { from: 2 }, [
    history(),
  ]);
  assert.deepEqual(session.beginComposition(state), { kind: "ALLOW" });
  const transaction = state.tr.insertText("非常").setMeta("composition", 1);
  assert.equal(
    session.inspectTransaction(state, transaction, { source: "composition" }).kind,
    "ALLOW",
  );
  state = applyAccepted(session, state, transaction);
  session.endComposition(false);
  assert.equal(state.doc.textContent, "我非常喜欢你");
  assert.equal(emitted.length, 0);

  let undoTransaction: Transaction | undefined;
  assert.equal(
    undo(state, (next) => {
      undoTransaction = next;
    }),
    true,
  );
  assert.ok(undoTransaction);
  state = applyAccepted(session, state, undoTransaction);
  assert.equal(state.doc.textContent, "我喜欢你");
  assert.equal(state.doc.rangeHasMark(1, 5, annotationTestSchema.marks.annotation), true);
});

test("destructive IME selection emits once, cancel changes nothing, and confirmation requires fresh exact re-entry", () => {
  const emitted = [];
  const session = createAnnotationGuardSession({
    baseAnnotationIds: ["a"],
    onPendingImpact: (pending) => emitted.push(pending),
  });
  const state = editorState([{ text: "我喜欢你", marks: [annotationMark("a")] }], {
    from: 1,
    to: 2,
  });

  const started = session.beginComposition(state);
  assert.equal(started.kind, "BLOCK");
  assert.equal(session.blockCompositionUpdate(), true);
  assert.equal(session.blockCompositionUpdate(), true);
  assert.equal(emitted.length, 1);
  session.endComposition(true);
  assert.equal(state.doc.textContent, "我喜欢你");
  assert.equal(session.pendingImpact(), null);

  const retry = session.beginComposition(state);
  assert.equal(retry.kind, "BLOCK");
  const confirmed = session.confirmPendingAnnotationImpact(retry.pending.token, state);
  assert.deepEqual(confirmed, {
    kind: "REENTER_COMPOSITION",
    message: "批注已确认待撤下，请重新输入刚才的文字",
  });
  assert.deepEqual(session.beginComposition(state), { kind: "AUTHORIZED" });
  const replacement = session.inspectTransaction(
    state,
    state.tr.insertText("他").setMeta("composition", 2),
    { source: "composition" },
  );
  assert.equal(replacement.kind, "REPLACE");
  const edited = applyAccepted(session, state, replacement.transaction);
  assert.equal(edited.doc.textContent, "他喜欢你");
  assert.equal(edited.doc.rangeHasMark(1, 2, annotationTestSchema.marks.annotation), false);
});

test("IME authorization expires when document or selection changes before re-entry", () => {
  const session = createAnnotationGuardSession({ baseAnnotationIds: ["a"] });
  const state = editorState([{ text: "我喜欢你", marks: [annotationMark("a")] }], {
    from: 1,
    to: 2,
  });
  const blocked = session.beginComposition(state);
  assert.equal(blocked.kind, "BLOCK");
  assert.equal(
    session.confirmPendingAnnotationImpact(blocked.pending.token, state).kind,
    "REENTER_COMPOSITION",
  );

  const moved = applyAccepted(
    session,
    state,
    state.tr.setSelection(TextSelection.create(state.doc, 3)),
  );
  assert.deepEqual(session.beginComposition(moved), { kind: "ALLOW" });
  assert.equal(session.hasCompositionAuthorization(), false);
});

test("cancelling an authorized composition restores its anchor and removes silent redo authorization", () => {
  const session = createAnnotationGuardSession({ baseAnnotationIds: ["a"] });
  let state = editorState(
    [{ text: "我喜欢你", marks: [annotationMark("a")] }],
    { from: 1, to: 2 },
    [history()],
  );
  const blocked = session.beginComposition(state);
  assert.equal(blocked.kind, "BLOCK");
  assert.equal(
    session.confirmPendingAnnotationImpact(blocked.pending.token, state).kind,
    "REENTER_COMPOSITION",
  );
  assert.deepEqual(session.beginComposition(state), { kind: "AUTHORIZED" });

  const replacement = session.inspectTransaction(
    state,
    state.tr.insertText("他").setMeta("composition", 3),
    { source: "composition" },
  );
  assert.equal(replacement.kind, "REPLACE");
  state = applyAccepted(session, state, replacement.transaction);
  assert.deepEqual(session.endComposition(true), ["a"]);

  const undoTransaction = historyTransaction(state, undo);
  assert.equal(session.inspectTransaction(state, undoTransaction).kind, "ALLOW");
  state = applyAccepted(session, state, undoTransaction);
  assert.equal(state.doc.textContent, "我喜欢你");
  assert.equal(state.doc.rangeHasMark(1, 5, annotationTestSchema.marks.annotation), true);
  assert.deepEqual(session.confirmedAnnotationDeletionIds(state.doc), []);

  const redoTransaction = historyTransaction(state, redo);
  assert.equal(session.inspectTransaction(state, redoTransaction).kind, "BLOCK");
});
