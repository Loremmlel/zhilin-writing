import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

import { isTopmostModal } from "../lib/ui/modal-stack.ts";

test("only the last mounted modal owns Escape and focus trapping", () => {
  const window = new Window();
  const outer = window.document.createElement("div");
  const inner = window.document.createElement("div");
  outer.dataset.modalDialog = "true";
  inner.dataset.modalDialog = "true";
  outer.append(inner);
  window.document.body.append(outer);
  assert.equal(isTopmostModal(outer as unknown as HTMLElement), false);
  assert.equal(isTopmostModal(inner as unknown as HTMLElement), true);
  inner.remove();
  assert.equal(isTopmostModal(outer as unknown as HTMLElement), true);
});

test("the shared modal is portaled outside caller layout containers", async () => {
  const source = await readFile(new URL("../components/modal-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, /createPortal\(/);
  assert.match(source, /document\.body/);
});
