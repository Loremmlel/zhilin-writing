import assert from "node:assert/strict";
import test from "node:test";

import { decideAssetReadAccess } from "../lib/assets/access.ts";

test("temporary uploads are owner-only", () => {
  const input = { status: "temporary" as const, ownerId: "owner", avatarRefCount: 0, activeCurrentRefCount: 0, unavailableCurrentRefCount: 0, revisionRefCount: 0 };
  assert.equal(decideAssetReadAccess(input, { userId: "owner", isAdmin: false }), "allow");
  assert.equal(decideAssetReadAccess(input, { userId: "other", isAdmin: false }), "deny");
});

test("active current post and avatar references are member-readable", () => {
  const base = { status: "permanent" as const, ownerId: "owner", unavailableCurrentRefCount: 0, revisionRefCount: 0 };
  assert.equal(decideAssetReadAccess({ ...base, avatarRefCount: 0, activeCurrentRefCount: 1 }, { userId: "member", isAdmin: false }), "allow");
  assert.equal(decideAssetReadAccess({ ...base, avatarRefCount: 1, activeCurrentRefCount: 0 }, { userId: "member", isAdmin: false }), "allow");
});

test("revision-only and unavailable-post assets are administrator-only even for the original owner", () => {
  const base = { status: "permanent" as const, ownerId: "owner", avatarRefCount: 0, activeCurrentRefCount: 0 };
  for (const refs of [
    { unavailableCurrentRefCount: 0, revisionRefCount: 1 },
    { unavailableCurrentRefCount: 1, revisionRefCount: 1 },
  ]) {
    assert.equal(decideAssetReadAccess({ ...base, ...refs }, { userId: "owner", isAdmin: false }), "deny");
    assert.equal(decideAssetReadAccess({ ...base, ...refs }, { userId: "admin", isAdmin: true }), "allow");
  }
});

test("an unreferenced permanent object is denied pending garbage collection", () => {
  assert.equal(decideAssetReadAccess({
    status: "permanent",
    ownerId: "owner",
    avatarRefCount: 0,
    activeCurrentRefCount: 0,
    unavailableCurrentRefCount: 0,
    revisionRefCount: 0,
  }, { userId: "owner", isAdmin: false }), "deny");
});
