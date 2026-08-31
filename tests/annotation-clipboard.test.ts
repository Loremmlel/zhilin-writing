import assert from "node:assert/strict";
import test from "node:test";

import { stripAnnotationMarksFromSlice, inheritDestinationAnnotationMark } from "../lib/editor/annotation-clipboard.ts";
import { createAnnotationGuardSession } from "../lib/editor/annotation-session.ts";
import { annotationMark, annotationTestSchema, editorState, inlineSlice } from "./annotation-test-schema.ts";

function markNames(value: ReturnType<typeof inlineSlice>) {
  const names: string[][] = [];
  value.content.descendants((node) => {
    if (node.isText) names.push(node.marks.map((mark) => mark.type.name));
  });
  return names;
}

test("copied and pasted slices lose annotation IDs while retaining ordinary rich formatting", () => {
  const source = inlineSlice([
    { text: "粗体", marks: [annotationMark("a"), annotationTestSchema.marks.strong.create()] },
    { text: "链接", marks: [annotationMark("b"), annotationTestSchema.marks.link.create({ href: "https://example.test" })] },
  ]);
  const sanitized = stripAnnotationMarksFromSlice(source, annotationTestSchema.marks.annotation);

  assert.equal(sanitized.content.textBetween(0, sanitized.content.size), "粗体链接");
  assert.deepEqual(markNames(sanitized), [["strong"], ["link"]]);
});

test("two adjacent copied anchors cannot create duplicate IDs at the paste destination", () => {
  const copied = inlineSlice([
    { text: "AAAA", marks: [annotationMark("a")] },
    { text: "BBBB", marks: [annotationMark("b")] },
  ]);
  const pasted = stripAnnotationMarksFromSlice(copied, annotationTestSchema.marks.annotation);
  assert.equal(pasted.content.textBetween(0, pasted.content.size), "AAAABBBB");
  assert.equal(markNames(pasted).every((marks) => !marks.includes("annotation")), true);
});

test("plain pasted text inherits only the destination annotation at a strict internal cursor", () => {
  const state = editorState([{ text: "AB", marks: [annotationMark("a")] }], { from: 2 });
  const pasted = inheritDestinationAnnotationMark(
    stripAnnotationMarksFromSlice(inlineSlice([{ text: "X" }]), annotationTestSchema.marks.annotation),
    state,
    annotationTestSchema.marks.annotation,
  );
  assert.deepEqual(markNames(pasted), [["annotation"]]);

  const boundary = editorState([{ text: "AB", marks: [annotationMark("a")] }], { from: 1 });
  assert.deepEqual(markNames(inheritDestinationAnnotationMark(inlineSlice([{ text: "X" }]), boundary, annotationTestSchema.marks.annotation)), [[]]);
});

test("move-drop source deletion is inspected by the same guard", () => {
  const state = editorState([
    { text: "AA", marks: [annotationMark("a")] },
    { text: " tail" },
  ], { from: 1, to: 3 });
  const transaction = state.tr.deleteSelection().setMeta("uiEvent", "drop");
  const session = createAnnotationGuardSession({ baseAnnotationIds: ["a"] });
  const decision = session.inspectTransaction(state, transaction);
  assert.equal(decision.kind, "BLOCK");
  assert.deepEqual(decision.pending.affectedAnnotationIds, ["a"]);
});
