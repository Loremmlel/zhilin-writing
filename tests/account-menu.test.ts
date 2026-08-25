import assert from "node:assert/strict";
import test from "node:test";

import { isAccountMenuDismissKey, isOutsideAccountMenu } from "../lib/ui/account-menu.ts";

test("the account menu dismisses only for outside targets", () => {
  const inside = {} as Node;
  const outside = {} as Node;
  const container = { contains: (target: Node) => target === inside };
  assert.equal(isOutsideAccountMenu(container, inside), false);
  assert.equal(isOutsideAccountMenu(container, outside), true);
});

test("Escape is the keyboard dismissal contract", () => {
  assert.equal(isAccountMenuDismissKey("Escape"), true);
  assert.equal(isAccountMenuDismissKey("Enter"), false);
  assert.equal(isAccountMenuDismissKey("Tab"), false);
});
