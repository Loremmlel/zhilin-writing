import assert from "node:assert/strict";
import test from "node:test";

import {
  commitAnnotationMutation,
  planAnnotationCreation,
} from "../lib/annotations/transaction.ts";

const A = "ann_550e8400-e29b-41d4-a716-446655440000";
const REVISION = "550e8400-e29b-41d4-a716-446655440000";

test("annotation creation changes canonical structure and activity but not author edit time", () => {
  const editedAt = new Date(300);
  const result = planAnnotationCreation(
    {
      postId: "post",
      postAuthorId: "author",
      actorUserId: "b",
      title: "标题",
      markdown: "我 **非常喜欢** 你",
      currentRevisionId: "r3",
      currentRevisionNumber: 3,
      editedAt,
      lastActivityAt: new Date(400),
      currentAnchorIds: [],
    },
    {
      baseRevisionId: "r3",
      annotationId: A,
      revisionId: REVISION,
      selection: {
        blockOrdinal: 0,
        endBlockOrdinal: 0,
        blockTextFrom: 2,
        blockTextTo: 6,
        selectedText: "非常喜欢",
      },
    },
    new Date(500),
  );
  assert.equal(result.revisionKind, "ANNOTATION_STATE");
  assert.equal(result.revisionNumber, 4);
  assert.equal(result.editedAt, editedAt);
  assert.equal(result.lastActivityAt.getTime(), 500);
  assert.equal(result.originalSelectedText, "非常喜欢");
  assert.equal(result.notificationRecipientUserId, "author");
  assert.match(result.markdown, /:annotation\[/);
  assert.match(result.markdown, /\*\*非常喜欢\*\*/);
});

test("annotation creation persists one logical anchor across consecutive blocks", () => {
  const result = planAnnotationCreation(
    {
      postId: "post",
      postAuthorId: "author",
      actorUserId: "author",
      title: "标题",
      markdown: "第一段\n\n第二段",
      currentRevisionId: "r1",
      currentRevisionNumber: 1,
      editedAt: null,
      lastActivityAt: new Date(400),
      currentAnchorIds: [],
    },
    {
      baseRevisionId: "r1",
      annotationId: A,
      revisionId: REVISION,
      selection: {
        blockOrdinal: 0,
        endBlockOrdinal: 1,
        blockTextFrom: 1,
        blockTextTo: 2,
        selectedText: "一段\n\n第二",
      },
    },
    new Date(500),
  );

  assert.equal(result.markdown.match(new RegExp(A, "g"))?.length, 2);
  assert.deepEqual(result.anchorIds, [A]);
  assert.equal(result.originalSelectedText, "一段\n\n第二");
});

test("creation rejects stale revisions and mismatched current anchor sets", () => {
  const current = {
    postId: "p",
    postAuthorId: "a",
    actorUserId: "b",
    title: "t",
    markdown: `:annotation[已有]{#${A}} 新文字`,
    currentRevisionId: "r3",
    currentRevisionNumber: 3,
    editedAt: null,
    lastActivityAt: new Date(),
    currentAnchorIds: [A],
  };
  const next = {
    baseRevisionId: "r2",
    annotationId: "ann_123e4567-e89b-42d3-a456-426614174000",
    revisionId: REVISION,
    selection: {
      blockOrdinal: 0,
      endBlockOrdinal: 0,
      blockTextFrom: 3,
      blockTextTo: 6,
      selectedText: "新文字",
    },
  };
  assert.throws(() => planAnnotationCreation(current, next, new Date()), /帖子已更新/);
  assert.throws(
    () =>
      planAnnotationCreation(
        { ...current, currentAnchorIds: [] },
        { ...next, baseRevisionId: "r3" },
        new Date(),
      ),
    /锚点状态不一致/,
  );
});

test("annotation batch is one consistency boundary", async () => {
  const calls: string[][] = [];
  await commitAnnotationMutation(
    async (items) => {
      calls.push(items);
    },
    ["guard", "revision", "annotation", "post", "anchor", "snapshot", "event", "notification"],
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    () =>
      commitAnnotationMutation(async () => {
        throw new Error("EDIT_CONFLICT");
      }, ["guard", "event"]),
    /EDIT_CONFLICT/,
  );
});
