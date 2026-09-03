import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationLayoutMode,
  nextAnnotationSheetState,
  resolveAnnotationSheetId,
  shouldUseAnnotationSheet,
} from "../lib/annotations/responsive.ts";

test("annotation threads use a bottom sheet only at compact widths", () => {
  assert.equal(shouldUseAnnotationSheet(900), true);
  assert.equal(shouldUseAnnotationSheet(1059), true);
  assert.equal(shouldUseAnnotationSheet(1060), false);
  assert.equal(annotationLayoutMode(1059), "compact");
  assert.equal(annotationLayoutMode(1060), "desktop");
  assert.equal(
    nextAnnotationSheetState(null, { type: "activate", annotationId: "a", compact: true }),
    "a",
  );
  assert.equal(
    nextAnnotationSheetState(null, { type: "activate", annotationId: "a", compact: false }),
    null,
  );
  assert.equal(nextAnnotationSheetState("a", { type: "close" }), null);
});

test("readonly editor sheet closes when its live anchor retires and can reopen after Undo", () => {
  assert.equal(resolveAnnotationSheetId("a", ["a", "b"]), "a");
  assert.equal(resolveAnnotationSheetId("a", ["b"]), null);
  assert.equal(resolveAnnotationSheetId("a", ["a", "b"]), "a");
});
