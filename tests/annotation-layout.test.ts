import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationAnchorGeometry,
  annotationConnectorPath,
  layoutAnnotationCards,
  sameAnnotationCardTops,
  sameAnnotationConnectors,
} from "../lib/annotations/layout.ts";

test("sidebar cards follow document order and do not overlap", () => {
  const heights = new Map([
    ["b", 80],
    ["a", 120],
    ["c", 60],
  ]);
  const result = layoutAnnotationCards(
    [
      { annotationId: "b", top: 40, right: 100, height: 20 },
      { annotationId: "a", top: 10, right: 100, height: 20 },
      { annotationId: "c", top: 45, right: 100, height: 20 },
    ],
    heights,
    12,
  );
  assert.deepEqual(result.cards, [
    { annotationId: "a", top: 10 },
    { annotationId: "b", top: 142 },
    { annotationId: "c", top: 234 },
  ]);
  assert.equal(result.height, 294);
});

test("sidebar placement ignores anchors that are not present in the live editor document", () => {
  const heights = new Map([
    ["present", 80],
    ["retired", 120],
  ]);
  const result = layoutAnnotationCards(
    [{ annotationId: "present", top: 24, right: 100, height: 20 }],
    heights,
    12,
  );
  assert.deepEqual(result.cards, [{ annotationId: "present", top: 24 }]);
  assert.equal(result.height, 104);
});

test("multi-line anchors use the first visible document rect as a stable vertical target", () => {
  const geometry = annotationAnchorGeometry(
    [
      { top: 130, right: 440, bottom: 150, left: 210, width: 230, height: 20 },
      { top: 108, right: 620, bottom: 128, left: 500, width: 120, height: 20 },
      { top: 108, right: 480, bottom: 128, left: 220, width: 260, height: 20 },
      { top: 90, right: 90, bottom: 90, left: 90, width: 0, height: 0 },
    ],
    { top: 80, left: 200 },
  );
  assert.deepEqual(geometry, { top: 28, right: 280, height: 20 });
});

test("connectors stay in the gutter and simplify when the gutter is too narrow", () => {
  assert.equal(
    annotationConnectorPath({ startX: 740, startY: 90, endX: 802, endY: 150 }),
    "M 740 90 C 766.04 90, 775.96 150, 802 150",
  );
  assert.equal(
    annotationConnectorPath({ startX: 740, startY: 90, endX: 755, endY: 150 }),
    "M 740 90 L 755 150",
  );
});

test("unchanged card and connector geometry can preserve React state identity", () => {
  assert.equal(sameAnnotationCardTops({ a: 10, b: 42 }, { a: 10, b: 42 }), true);
  assert.equal(sameAnnotationCardTops({ a: 10 }, { a: 11 }), false);
  assert.equal(
    sameAnnotationConnectors(
      [{ annotationId: "a", path: "M 0 0 L 1 1" }],
      [{ annotationId: "a", path: "M 0 0 L 1 1" }],
    ),
    true,
  );
  assert.equal(
    sameAnnotationConnectors(
      [{ annotationId: "a", path: "M 0 0 L 1 1" }],
      [{ annotationId: "b", path: "M 0 0 L 1 1" }],
    ),
    false,
  );
});
