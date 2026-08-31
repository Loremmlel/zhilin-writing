import assert from "node:assert/strict";
import test from "node:test";
import { layoutAnnotationCards } from "../lib/annotations/layout.ts";

test("sidebar cards follow document order and do not overlap", () => {
  const heights = new Map([["b", 80], ["a", 120], ["c", 60]]);
  const result = layoutAnnotationCards([
    { annotationId: "b", top: 40, right: 100, height: 20 },
    { annotationId: "a", top: 10, right: 100, height: 20 },
    { annotationId: "c", top: 45, right: 100, height: 20 },
  ], heights, 12);
  assert.deepEqual(result.cards, [{ annotationId: "a", top: 10 }, { annotationId: "b", top: 142 }, { annotationId: "c", top: 234 }]);
  assert.equal(result.height, 294);
});

test("sidebar placement ignores anchors that are not present in the live editor document", () => {
  const heights = new Map([["present", 80], ["retired", 120]]);
  const result = layoutAnnotationCards([
    { annotationId: "present", top: 24, right: 100, height: 20 },
  ], heights, 12);
  assert.deepEqual(result.cards, [{ annotationId: "present", top: 24 }]);
  assert.equal(result.height, 104);
});
