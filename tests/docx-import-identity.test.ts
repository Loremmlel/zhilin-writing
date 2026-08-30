import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationSourceMetadata,
  buildAnnotationAuthorView,
} from "../lib/annotations/identity.ts";
import {
  assertNativeAnnotationMutation,
  getAnnotationMutationPermissions,
  sortAnnotationReplyRows,
  sortAnnotationRowsByAnchorPosition,
} from "../lib/annotations/policy.ts";

const nativeUser = { id: "native", displayName: "站内作者", avatarAssetId: "avatar" };
const attributedUser = { id: "mapped", displayName: "关联用户", avatarAssetId: null };

test("imported identities remain visible without a native user and keep attribution secondary", () => {
  const imported = {
    sourceType: "DOCX_IMPORT" as const,
    authorId: null,
    sourceAuthorName: "林柚子",
    sourceInitials: "LYZ",
    sourceResolved: true,
  };

  assert.deepEqual(buildAnnotationAuthorView(imported, null, null), {
    sourceType: "DOCX_IMPORT",
    id: null,
    displayName: "林柚子",
    avatarAssetId: null,
    initials: "LYZ",
    attributedUser: null,
    sourceResolved: true,
  });
  assert.deepEqual(buildAnnotationAuthorView(imported, null, attributedUser).attributedUser, {
    id: "mapped",
    displayName: "关联用户",
  });

  const native = buildAnnotationAuthorView({
    sourceType: "NATIVE",
    authorId: nativeUser.id,
    sourceAuthorName: null,
    sourceInitials: null,
    sourceResolved: null,
  }, nativeUser, null);
  assert.equal(native.displayName, "站内作者");
  assert.equal(native.avatarAssetId, "avatar");
});

test("imported source metadata keeps Word identity, initials, resolution, and attribution visible", () => {
  assert.equal(annotationSourceMetadata({
    sourceType: "DOCX_IMPORT",
    id: null,
    displayName: "林柚子",
    avatarAssetId: null,
    initials: "LYZ",
    attributedUser: { id: "mapped", displayName: "关联用户" },
    sourceResolved: true,
  }), "Word 导入 · 缩写 LYZ · Word 中已解决 · 关联 关联用户");
  assert.equal(annotationSourceMetadata({
    sourceType: "NATIVE",
    id: "native",
    displayName: "站内作者",
    avatarAssetId: null,
    initials: null,
    attributedUser: null,
    sourceResolved: false,
  }), null);
});

test("root order follows canonical Markdown anchor position", () => {
  const first = "ann_550e8400-e29b-41d4-a716-446655440000";
  const second = "ann_123e4567-e89b-42d3-a456-426614174000";
  const rows = [
    { annotation: { id: first, createdAt: new Date(1) } },
    { annotation: { id: second, createdAt: new Date(2) } },
  ];
  const ordered = sortAnnotationRowsByAnchorPosition(
    `:annotation[第二]{#${second}}\n\n:annotation[第一]{#${first}}`,
    rows,
  );
  assert.deepEqual(ordered.map((row) => row.annotation.id), [second, first]);
});

test("imported replies use Word time, document order, and source id while native order stays unchanged", () => {
  const imported = (id: string, sourceCreatedAt: Date | null, sourceDocumentOrder: number, sourceCommentId: string) => ({
    reply: { id, sourceType: "DOCX_IMPORT" as const, sourceCreatedAt, sourceDocumentOrder, sourceCommentId, createdAt: new Date(100) },
  });
  const native = (id: string, createdAt: Date) => ({
    reply: { id, sourceType: "NATIVE" as const, sourceCreatedAt: null, sourceDocumentOrder: null, sourceCommentId: null, createdAt },
  });

  assert.deepEqual(
    sortAnnotationReplyRows([
      imported("later", new Date(20), 1, "2"),
      imported("earlier", new Date(10), 9, "9"),
    ]).map((row) => row.reply.id),
    ["earlier", "later"],
  );
  assert.deepEqual(
    sortAnnotationReplyRows([
      imported("source-b", null, 2, "10"),
      imported("source-a", null, 2, "2"),
      imported("document-first", null, 1, "99"),
    ]).map((row) => row.reply.id),
    ["document-first", "source-b", "source-a"],
  );
  assert.deepEqual(
    sortAnnotationReplyRows([native("later-native", new Date(20)), native("earlier-native", new Date(10))]).map((row) => row.reply.id),
    ["earlier-native", "later-native"],
  );
});

test("mixed dated and undated Word replies have one deterministic total order", () => {
  const imported = (id: string, sourceCreatedAt: Date | null, sourceDocumentOrder: number) => ({
    reply: {
      id,
      sourceType: "DOCX_IMPORT" as const,
      sourceCreatedAt,
      sourceDocumentOrder,
      sourceCommentId: id,
      createdAt: new Date(100),
    },
  });
  const later = imported("later", new Date(20), 1);
  const earlier = imported("earlier", new Date(10), 3);
  const undated = imported("undated", null, 2);
  const permutations = [
    [later, earlier, undated],
    [later, undated, earlier],
    [earlier, later, undated],
    [earlier, undated, later],
    [undated, later, earlier],
    [undated, earlier, later],
  ];

  for (const rows of permutations) {
    assert.deepEqual(
      sortAnnotationReplyRows(rows).map((row) => row.reply.id),
      ["earlier", "later", "undated"],
    );
  }
});

test("attribution grants no mutation permission while post author or importer may remove the imported thread", () => {
  const imported = { sourceType: "DOCX_IMPORT" as const, authorId: null, importedByUserId: "importer" };
  assert.deepEqual(getAnnotationMutationPermissions(imported, { actorUserId: "mapped", postAuthorId: "importer" }), {
    canDelete: false,
    canRemoveImportedThread: false,
  });
  assert.equal(getAnnotationMutationPermissions(imported, { actorUserId: "importer", postAuthorId: "importer" }).canRemoveImportedThread, true);
  assert.equal(getAnnotationMutationPermissions(imported, { actorUserId: "post-author", postAuthorId: "post-author" }).canRemoveImportedThread, true);
  assert.throws(() => assertNativeAnnotationMutation(imported), /Word 导入/);
});
