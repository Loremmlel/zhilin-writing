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
  assert.equal(shouldUseAnnotationSheet(1115), true);
  assert.equal(shouldUseAnnotationSheet(1116), false);
  assert.equal(annotationLayoutMode(1115), "compact");
  assert.equal(annotationLayoutMode(1116), "desktop");
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
