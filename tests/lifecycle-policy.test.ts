import assert from "node:assert/strict";
import test from "node:test";

import {
  adminAuditDedupeKey,
  assetGcEligibility,
  canExposeActivitySnapshot,
  contentState,
  deletePostConfirmation,
  deleteReplyConfirmation,
  deriveLastActivityAt,
  isPostDiscussionReachable,
  shouldRenderReplyPlaceholder,
  validateLifecycleOperationId,
} from "../lib/lifecycle/policy.ts";

test("administrator hidden state takes priority without erasing author deletion", () => {
  const deletedAt = new Date(1_000);
  const hiddenAt = new Date(2_000);

  assert.deepEqual(contentState({ deletedAt, hiddenAt }), {
    state: "hidden",
    userDeleted: true,
    adminHidden: true,
  });
  assert.equal(contentState({ deletedAt, hiddenAt: null }).state, "deleted");
  assert.equal(contentState({ deletedAt: null, hiddenAt: null }).state, "normal");
});

test("an unavailable reply renders only when a visible discussion depends on it", () => {
  assert.equal(shouldRenderReplyPlaceholder({ state: "deleted", visibleDependentCount: 0 }), false);
  assert.equal(shouldRenderReplyPlaceholder({ state: "deleted", visibleDependentCount: 1 }), true);
  assert.equal(shouldRenderReplyPlaceholder({ state: "hidden", visibleDependentCount: 2 }), true);
  assert.equal(shouldRenderReplyPlaceholder({ state: "normal", visibleDependentCount: 0 }), false);
});

test("an unavailable post stays reachable only for another member's public discussion", () => {
  const replies = [
    { authorId: "author", deletedAt: null, hiddenAt: null },
    { authorId: "other", deletedAt: new Date(2_000), hiddenAt: null },
  ];
  assert.equal(isPostDiscussionReachable("author", replies), false);
  assert.equal(
    isPostDiscussionReachable("author", [
      ...replies,
      { authorId: "other", deletedAt: null, hiddenAt: null },
    ]),
    true,
  );
});

test("imported Word identities do not masquerade as another member's discussion", () => {
  assert.equal(
    isPostDiscussionReachable("author", [{ authorId: null, deletedAt: null, hiddenAt: null }]),
    false,
  );
});

test("recent activity derives from publication times of currently public replies", () => {
  const postPublishedAt = new Date(10_000);
  const value = deriveLastActivityAt(postPublishedAt, [
    { publishedAt: new Date(11_000), deletedAt: null, hiddenAt: null },
    { publishedAt: new Date(12_000), deletedAt: new Date(12_500), hiddenAt: null },
    { publishedAt: new Date(13_000), deletedAt: null, hiddenAt: new Date(13_500) },
  ]);
  assert.equal(value.getTime(), 11_000);
  assert.equal(deriveLastActivityAt(postPublishedAt, []).getTime(), 10_000);
});

test("asset garbage collection requires every current, revision, and avatar reference to be gone", () => {
  const now = new Date(10_000);
  const cases = [
    [
      {
        status: "permanent",
        currentRefCount: 1,
        revisionRefCount: 0,
        avatarRefCount: 0,
        expiresAt: null,
      },
      "referenced",
    ],
    [
      {
        status: "permanent",
        currentRefCount: 0,
        revisionRefCount: 1,
        avatarRefCount: 0,
        expiresAt: null,
      },
      "referenced",
    ],
    [
      {
        status: "permanent",
        currentRefCount: 0,
        revisionRefCount: 0,
        avatarRefCount: 1,
        expiresAt: null,
      },
      "referenced",
    ],
    [
      {
        status: "temporary",
        currentRefCount: 0,
        revisionRefCount: 0,
        avatarRefCount: 0,
        expiresAt: new Date(11_000),
      },
      "temporary-not-expired",
    ],
    [
      {
        status: "temporary",
        currentRefCount: 0,
        revisionRefCount: 0,
        avatarRefCount: 0,
        expiresAt: new Date(9_000),
      },
      "eligible",
    ],
    [
      {
        status: "permanent",
        currentRefCount: 0,
        revisionRefCount: 0,
        avatarRefCount: 0,
        expiresAt: null,
      },
      "eligible",
    ],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(assetGcEligibility({ ...input, now }), expected);
  }
});

test("administrator audit transition keys are stable for retries and distinct for later transitions", () => {
  assert.equal(
    adminAuditDedupeKey("POST_HIDDEN", "POST", "post-1", null),
    adminAuditDedupeKey("POST_HIDDEN", "POST", "post-1", null),
  );
  assert.notEqual(
    adminAuditDedupeKey("POST_UNHIDDEN", "POST", "post-1", new Date(1_000)),
    adminAuditDedupeKey("POST_UNHIDDEN", "POST", "post-1", new Date(2_000)),
  );
});

test("delete confirmations explain when other people's discussion survives", () => {
  assert.match(deletePostConfirmation(true), /其他用户已经发布的回复仍会保留/);
  assert.match(deleteReplyConfirmation(true), /其他用户的回复仍然保留/);
  assert.doesNotMatch(deletePostConfirmation(false), /其他用户/);
  assert.doesNotMatch(deleteReplyConfirmation(false), /其他用户/);
});

test("lifecycle operation IDs accept only bounded UUIDs", () => {
  assert.equal(
    validateLifecycleOperationId("550e8400-e29b-41d4-a716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000",
  );
  assert.throws(() => validateLifecycleOperationId("forged"), /操作标识无效/);
});

test("activity snapshots are withheld when their post or reply target is unavailable", () => {
  assert.equal(canExposeActivitySnapshot("normal", "POST_CREATED", "normal"), true);
  assert.equal(canExposeActivitySnapshot("deleted", "POST_CREATED", "normal"), false);
  assert.equal(canExposeActivitySnapshot("normal", "POST_REPLY_CREATED", "hidden"), false);
  assert.equal(canExposeActivitySnapshot("normal", "POST_REPLY_CREATED", "normal"), true);
});
