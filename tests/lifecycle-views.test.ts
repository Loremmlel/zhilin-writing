import assert from "node:assert/strict";
import test from "node:test";

import { buildPostLifecycleView, buildReplyLifecycleViews } from "../lib/lifecycle/views.ts";

test("deleted post exposes no content but keeps a reachable other-member discussion", () => {
  const view = buildPostLifecycleView(
    {
      authorId: "author",
      deletedAt: new Date(1_000),
      hiddenAt: null,
    },
    [
      { authorId: "author", deletedAt: null, hiddenAt: null },
      { authorId: "member", deletedAt: null, hiddenAt: null },
    ],
  );
  assert.deepEqual(view, {
    state: "deleted",
    contentVisible: false,
    hasOtherMemberDiscussion: true,
    discussionReachable: true,
    placeholder: "该帖子已被作者删除。",
  });
});

test("administrator-hidden state wins and an unavailable post without other-member replies is controlled", () => {
  const view = buildPostLifecycleView(
    {
      authorId: "author",
      deletedAt: new Date(1_000),
      hiddenAt: new Date(2_000),
    },
    [{ authorId: "author", deletedAt: null, hiddenAt: null }],
  );
  assert.deepEqual(view, {
    state: "hidden",
    contentVisible: false,
    hasOtherMemberDiscussion: false,
    discussionReachable: false,
    placeholder: "该帖子已被管理员隐藏。",
  });
});

test("reply tree retains only unavailable ancestors required by visible descendants", () => {
  const views = buildReplyLifecycleViews([
    {
      id: "root-a",
      authorId: "a",
      rootReplyId: null,
      replyToReplyId: null,
      deletedAt: new Date(1_000),
      hiddenAt: null,
    },
    {
      id: "nested-b",
      authorId: "b",
      rootReplyId: "root-a",
      replyToReplyId: "root-a",
      deletedAt: new Date(1_100),
      hiddenAt: null,
    },
    {
      id: "nested-c",
      authorId: "c",
      rootReplyId: "root-a",
      replyToReplyId: "nested-b",
      deletedAt: null,
      hiddenAt: null,
    },
    {
      id: "orphan-deleted",
      authorId: "d",
      rootReplyId: null,
      replyToReplyId: null,
      deletedAt: new Date(1_200),
      hiddenAt: null,
    },
  ]);

  assert.deepEqual(
    views.map((view) => ({ id: view.id, state: view.state, contentVisible: view.contentVisible })),
    [
      { id: "root-a", state: "deleted", contentVisible: false },
      { id: "nested-b", state: "deleted", contentVisible: false },
      { id: "nested-c", state: "normal", contentVisible: true },
    ],
  );
  assert.equal(views.filter((view) => view.contentVisible).length, 1);
  assert.equal(views[0].placeholder, "该回复已被作者删除。");
  assert.equal(views[0].visibleOtherAuthorDependentCount, 1);
  assert.equal(views[1].visibleOtherAuthorDependentCount, 1);
});

test("hidden reply placeholder never reuses stored Markdown", () => {
  const [view] = buildReplyLifecycleViews([
    {
      id: "root",
      authorId: "a",
      rootReplyId: null,
      replyToReplyId: null,
      deletedAt: null,
      hiddenAt: new Date(1_000),
    },
    {
      id: "child",
      authorId: "b",
      rootReplyId: "root",
      replyToReplyId: "root",
      deletedAt: null,
      hiddenAt: null,
    },
  ]);
  assert.equal(view.state, "hidden");
  assert.equal(view.contentVisible, false);
  assert.equal(view.placeholder, "该回复已被管理员隐藏。");
});

test("a notification deep link can retain its unavailable reply placeholder", () => {
  const views = buildReplyLifecycleViews(
    [
      {
        id: "deleted-target",
        authorId: "a",
        rootReplyId: null,
        replyToReplyId: null,
        deletedAt: new Date(1_000),
        hiddenAt: null,
      },
    ],
    { requiredPlaceholderIds: ["deleted-target"] },
  );
  assert.equal(views.length, 1);
  assert.equal(views[0]?.contentVisible, false);
  assert.equal(views[0]?.placeholder, "该回复已被作者删除。");
});
