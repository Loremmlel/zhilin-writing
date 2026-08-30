import assert from "node:assert/strict";
import test from "node:test";

import { planAnnotationRestore } from "../lib/revisions/policy.ts";

const ROOT_ID = "ann_00000000-0000-4000-8000-000000000001";

test("restoring a DOCX revision restores every imported reply state without touching native replies", () => {
  const sourceReplyStates = [
    {
      annotationReplyId: "00000000-0000-4000-8000-000000000101",
      deletedAt: null,
      deletedByUserId: null,
      hiddenAt: null,
      hiddenByUserId: null,
    },
    {
      annotationReplyId: "00000000-0000-4000-8000-000000000102",
      deletedAt: new Date("2026-08-28T01:00:00.000Z"),
      deletedByUserId: "importer",
      hiddenAt: new Date("2026-08-28T02:00:00.000Z"),
      hiddenByUserId: "administrator",
    },
  ];
  const currentReplyStates = sourceReplyStates.map((state) => ({
    ...state,
    deletedAt: new Date("2026-08-30T01:00:00.000Z"),
    deletedByUserId: "post-author",
    hiddenAt: null,
    hiddenByUserId: null,
  }));

  const result = planAnnotationRestore({
    currentMarkdown: `:annotation[正文]{#${ROOT_ID}}`,
    currentAnchorIds: [ROOT_ID],
    currentStates: [activeRoot()],
    currentImportedReplyStates: currentReplyStates,
    sourceMarkdown: `:annotation[正文]{#${ROOT_ID}}`,
    sourceStates: [activeRoot()],
    sourceImportedReplyStates: sourceReplyStates,
  });

  assert.deepEqual(result.restoredImportedReplyStates, sourceReplyStates);
  assert.deepEqual(
    result.restoredImportedReplyStates.map((state) => state.annotationReplyId),
    sourceReplyStates.map((state) => state.annotationReplyId),
  );
  assert.equal(
    result.restoredImportedReplyStates.some((state) => state.annotationReplyId === "native-reply"),
    false,
  );
});

test("duplicate imported reply snapshot rows are rejected instead of being synthesized", () => {
  const duplicate = {
    annotationReplyId: "00000000-0000-4000-8000-000000000101",
    deletedAt: null,
    deletedByUserId: null,
    hiddenAt: null,
    hiddenByUserId: null,
  };

  assert.throws(() => planAnnotationRestore({
    currentMarkdown: `:annotation[正文]{#${ROOT_ID}}`,
    currentAnchorIds: [ROOT_ID],
    currentStates: [activeRoot()],
    currentImportedReplyStates: [duplicate],
    sourceMarkdown: `:annotation[正文]{#${ROOT_ID}}`,
    sourceStates: [activeRoot()],
    sourceImportedReplyStates: [duplicate, duplicate],
  }), /导入批注回复快照不一致/);
});

function activeRoot() {
  return {
    annotationId: ROOT_ID,
    deletedAt: null,
    deletedByUserId: null,
    hiddenAt: null,
    hiddenByUserId: null,
  };
}
