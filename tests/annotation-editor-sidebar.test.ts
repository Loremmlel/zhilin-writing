import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import {
  annotationThreadCapabilities,
  createAnnotationLayoutScheduler,
  findAnnotationAnchorElements,
  findAnnotationIdFromTarget,
  visibleAnnotationIds,
} from "../lib/annotations/layout.ts";

test("editor annotation threads expose reading and location without mutation controls", () => {
  assert.deepEqual(annotationThreadCapabilities("readonly"), {
    activate: true,
    locate: true,
    reply: false,
    delete: false,
    remove: false,
    moderate: false,
  });
});

test("live editor anchors activate by stable annotation id and support split DOM marks", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = '<p><mark data-annotation-id="a"><strong>前半</strong></mark><mark data-annotation-id="a">后半</mark><mark data-annotation-id="b">另一条</mark></p>';
  window.document.body.append(root);

  const nested = root.querySelector("strong");
  assert.equal(findAnnotationIdFromTarget(root as unknown as Element, nested as unknown as Element), "a");
  assert.equal(findAnnotationAnchorElements(root as unknown as Element, "a").length, 2);
  assert.equal(findAnnotationAnchorElements(root as unknown as Element, "missing").length, 0);
});

test("pending retirement hides cards and Undo restores them from live session state", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(visibleAnnotationIds(ids, ["b"]), ["a", "c"]);
  assert.deepEqual(visibleAnnotationIds(ids, []), ids);
});

test("connector measurement coalesces editor mutations into one animation frame", () => {
  let nextFrameId = 0;
  let measured = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const scheduler = createAnnotationLayoutScheduler(
    () => { measured += 1; },
    (callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    (id) => {
      cancelled.push(id);
      frames.delete(id);
    },
  );

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(frames.size, 1);
  const firstFrame = frames.get(1);
  frames.delete(1);
  firstFrame?.(0);
  assert.equal(measured, 1);

  scheduler.schedule();
  assert.equal(frames.size, 1);
  scheduler.destroy();
  assert.deepEqual(cancelled, [2]);
});
