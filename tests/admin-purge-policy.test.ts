import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeAdminSelection,
  removeAnnotationFromMarkdown,
  replyIdsForPurge,
} from "../lib/admin/purge-policy.ts";
import {
  collectAnnotationIds,
  parseAnnotationMarkdown,
  visiblePostText,
} from "../lib/annotations/markdown.ts";

test("administrator selection stays page-bounded and deduplicated", () => {
  assert.deepEqual(normalizeAdminSelection([" a ", "b", "a", ""]), ["a", "b"]);
  assert.throws(() => normalizeAdminSelection([]), /至少一条/);
  assert.throws(
    () => normalizeAdminSelection(Array.from({ length: 21 }, (_, index) => String(index))),
    /最多管理当前页的 20 条/,
  );
});

test("purging a root reply removes its thread while a nested reply removes only itself", () => {
  const rows = [
    { id: "root", rootReplyId: null },
    { id: "child-a", rootReplyId: "root" },
    { id: "child-b", rootReplyId: "root" },
  ];
  assert.deepEqual(replyIdsForPurge(rows[0]!, rows), ["root", "child-a", "child-b"]);
  assert.deepEqual(replyIdsForPurge(rows[1]!, rows), ["child-a"]);
});

test("purging an annotation removes every directive without changing visible text", () => {
  const markdown = '前文 :annotation[第一段]{id="ann-1"}\n\n:annotation[第二段]{id="ann-1"} 后文\n';
  const next = removeAnnotationFromMarkdown(markdown, "ann-1");
  assert.deepEqual(collectAnnotationIds(parseAnnotationMarkdown(next)), []);
  assert.equal(
    visiblePostText(parseAnnotationMarkdown(next)),
    visiblePostText(parseAnnotationMarkdown(markdown)),
  );
  assert.equal(removeAnnotationFromMarkdown(next, "missing"), next);
});

test("administrator purge covers the dependency graph without deleting R2 objects inline", async () => {
  const [service, actions, schema] = await Promise.all([
    readFile(new URL("../lib/admin/purge-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(site)/admin/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  for (const relation of [
    "notifications",
    "activityEvents",
    "revisionAnnotationStates",
    "revisionImportedReplyStates",
    "postAnnotationAnchors",
    "annotationReplies",
    "annotations",
    "replies",
    "postTags",
    "postAssetRefs",
    "revisionAssetRefs",
    "importBatches",
    "postRevisions",
    "posts",
  ]) {
    assert.match(service, new RegExp(`delete\\(${relation}\\)`), `${relation} must be purged`);
  }
  assert.match(service, /set\(\{ postId: null \}\)/);
  assert.match(service, /removeAnnotationFromMarkdown\(revision\.markdown/);
  assert.match(service, /deriveLastActivityAt/);
  assert.doesNotMatch(service, /R2|deleteObject/);
  assert.match(actions, /getActionAdministratorAccess\(\)/);
  assert.match(schema, /"POST_PURGED"/);
  assert.match(schema, /"ANNOTATION_REPLY_PURGED"/);
});
