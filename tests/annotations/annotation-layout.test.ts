import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationAnchorGeometry,
  annotationConnectorPath,
  layoutAnnotationCards,
  sameAnnotationCardTops,
  sameAnnotationConnectors,
} from "../../lib/annotations/layout.ts";

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
    { annotationId: "a", top: 0 },
    { annotationId: "b", top: 132 },
    { annotationId: "c", top: 224 },
  ]);
  assert.equal(result.height, 284);
});

test("crowded cards share displacement while isolated cards keep their anchors", () => {
  const anchors = [40, 400, 440, 480, 1100].map((top, index) => ({
    annotationId: String(index),
    top,
    right: 100,
    height: 20,
  }));
  const heights = new Map(anchors.map(({ annotationId }) => [annotationId, 200]));
  heights.set("0", 100);
  const result = layoutAnnotationCards(anchors, heights, 14);
  assert.deepEqual(
    result.cards.map(({ top }) => top),
    [40, 226, 440, 654, 1100],
  );
  assert.equal(result.height, 1300);
});

test("neighboring groups merge when balancing would collide, respecting the body start", () => {
  const anchors = [600, 800, 810, 820].map((top, index) => ({
    annotationId: String(index),
    top,
    right: 100,
    height: 20,
  }));
  const heights = new Map(anchors.map(({ annotationId }) => [annotationId, 200]));
  // The three lower cards would move into the first card, so all four must move together.
  const balanced = layoutAnnotationCards(anchors, heights, 14);
  assert.deepEqual(
    balanced.cards.map(({ top }) => top),
    [436.5, 650.5, 864.5, 1078.5],
  );
  const bounded = layoutAnnotationCards(anchors, heights, 14, 580);
  assert.deepEqual(
    bounded.cards.map(({ top }) => top),
    [580, 794, 1008, 1222],
  );
  assert.equal(bounded.height, 1422);
  assert.deepEqual(layoutAnnotationCards([], heights, 14, 80), { cards: [], height: 0 });
});

test("reply expansion rebalances variable-height cards and closing restores their positions", () => {
  const anchors = [400, 440, 480, 1400].map((top, index) => ({
    annotationId: String(index),
    top,
    right: 100,
    height: 20,
  }));
  const heights = new Map(anchors.map(({ annotationId }) => [annotationId, 200]));
  const initial = layoutAnnotationCards(anchors, heights, 14, 80);
  heights.set("1", 500);
  const expanded = layoutAnnotationCards(anchors, heights, 14, 80);
  assert.deepEqual(
    expanded.cards.map(({ top }) => top),
    [126, 340, 854, 1400],
  );
  assert.equal(expanded.height, 1600);
  heights.set("1", 200);
  assert.deepEqual(layoutAnnotationCards(anchors, heights, 14, 80), initial);
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
