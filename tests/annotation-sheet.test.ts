import assert from "node:assert/strict";
import test from "node:test";
import { nextAnnotationSheetState, shouldUseAnnotationSheet } from "../lib/annotations/responsive.ts";

test("annotation threads use a bottom sheet only at compact widths", () => {
  assert.equal(shouldUseAnnotationSheet(900), true);
  assert.equal(shouldUseAnnotationSheet(901), false);
  assert.equal(nextAnnotationSheetState(null, { type: "activate", annotationId: "a", compact: true }), "a");
  assert.equal(nextAnnotationSheetState(null, { type: "activate", annotationId: "a", compact: false }), null);
  assert.equal(nextAnnotationSheetState("a", { type: "close" }), null);
});
