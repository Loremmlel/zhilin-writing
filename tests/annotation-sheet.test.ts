import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationLayoutMode,
  resolveActiveAnnotationId,
  nextAnnotationSheetState,
  resolveAnnotationSheetId,
  shouldUseAnnotationSheet,
} from "../lib/annotations/responsive.ts";

test("annotation threads use a bottom sheet only at compact widths", () => {
  assert.equal(shouldUseAnnotationSheet(900), true);
  assert.equal(shouldUseAnnotationSheet(1181), true);
  assert.equal(shouldUseAnnotationSheet(1182), false);
  assert.equal(annotationLayoutMode(1181), "compact");
  assert.equal(annotationLayoutMode(1182), "desktop");
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

test("thread focus temporarily takes priority, hidden targets never leave orphan connectors", () => {
  assert.equal(resolveActiveAnnotationId("a", "b", ["a", "b"]), "b");
  assert.equal(resolveActiveAnnotationId("a", null, ["a", "b"]), "a");
  assert.equal(resolveActiveAnnotationId("a", "b", ["a"]), "a");
  assert.equal(resolveActiveAnnotationId("a", null, []), null);
  assert.equal(resolveActiveAnnotationId(null, null, ["a"]), null);
});
