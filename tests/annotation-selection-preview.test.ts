import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import {
  captureSavedAnnotationSelection,
  nextSelectionPreviewPhase,
  validateSavedAnnotationSelection,
} from "../lib/annotations/selection-preview.ts";

function selectedRange(window: Window, text: Text, from: number, to: number) {
  const range = window.document.createRange();
  range.setStart(text as never, from);
  range.setEnd(text as never, to);
  return range as unknown as Range;
}

test("selection preview survives composer pending failure and retry until success is visible", () => {
  let phase = nextSelectionPreviewPhase("hidden", "capture");
  assert.equal(phase, "bubble");
  phase = nextSelectionPreviewPhase(phase, "open-composer");
  assert.equal(phase, "composer");
  phase = nextSelectionPreviewPhase(phase, "submit");
  assert.equal(phase, "pending");
  phase = nextSelectionPreviewPhase(phase, "failure");
  assert.equal(phase, "failed");
  phase = nextSelectionPreviewPhase(phase, "retry");
  assert.equal(phase, "pending");
  phase = nextSelectionPreviewPhase(phase, "submit-succeeded");
  assert.equal(phase, "awaiting-annotation");
  phase = nextSelectionPreviewPhase(phase, "annotation-present");
  assert.equal(phase, "hidden");
});

test("cancel body click invalidation revision change and unmount clear preview", () => {
  for (const event of ["cancel", "body-click", "invalidate", "revision-change", "unmount"] as const) {
    assert.equal(nextSelectionPreviewPhase("composer", event), "hidden");
  }
});

test("saved selection remains authoritative after native DOM selection moves", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = "<p>我非常喜欢你</p><p>另一段</p>";
  window.document.body.append(root);
  const first = root.querySelectorAll("p")[0]!.firstChild as unknown as Text;
  const second = root.querySelectorAll("p")[1]!.firstChild as unknown as Text;
  const range = selectedRange(window, first, 1, 5);
  const descriptor = { blockOrdinal: 0, endBlockOrdinal: 0, blockTextFrom: 1, blockTextTo: 5, selectedText: "非常喜欢" };
  const saved = captureSavedAnnotationSelection({
    postId: "post",
    baseRevisionId: "revision",
    descriptor,
    root: root as unknown as Element,
    range,
    epoch: 3,
  });

  const moved = selectedRange(window, second, 0, 2);
  const nativeSelection = window.getSelection();
  nativeSelection?.removeAllRanges();
  nativeSelection?.addRange(moved as never);

  assert.equal(saved.selectedText, "非常喜欢");
  assert.deepEqual(saved.descriptor, descriptor);
  const restored = validateSavedAnnotationSelection(saved, {
    postId: "post",
    baseRevisionId: "revision",
    root: root as unknown as Element,
    epoch: 3,
  });
  assert.equal(restored?.toString(), "非常喜欢");
  assert.equal(validateSavedAnnotationSelection(saved, { postId: "post", baseRevisionId: "new", root: root as unknown as Element, epoch: 3 }), null);
  assert.equal(validateSavedAnnotationSelection(saved, { postId: "post", baseRevisionId: "revision", root: root as unknown as Element, epoch: 4 }), null);
});
