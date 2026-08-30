import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDocxAttributionNotices,
  formatDocxAttributionNotice,
  parseDocxAttributionNoticeMetadata,
} from "../lib/notifications/policy.ts";

test("one DOCX attribution notice aggregates every mapped Word comment per recipient", () => {
  const notices = buildDocxAttributionNotices({
    importBatchId: "00000000-0000-4000-8000-000000000001",
    eventId: "activity:post:post-1:created",
    postId: "post-1",
    postTitle: "导入的校刊",
    importerUserId: "importer",
    importerDisplayName: "柚子",
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    attributedUserIds: ["member-a", "member-a", "importer", null, "member-b"],
  });

  assert.deepEqual(notices.map((notice) => notice.recipientUserId), ["member-a", "member-b"]);
  assert.deepEqual(notices.map((notice) => parseDocxAttributionNoticeMetadata(notice.metadataJson)), [
    { postId: "post-1", postTitle: "导入的校刊", importerDisplayName: "柚子", commentCount: 2 },
    { postId: "post-1", postTitle: "导入的校刊", importerDisplayName: "柚子", commentCount: 1 },
  ]);
  assert.ok(notices.every((notice) => notice.notificationType === "DOCX_ATTRIBUTION_NOTICE"));
  assert.ok(notices.every((notice) => notice.annotationId === null && notice.annotationReplyId === null));
});

test("DOCX attribution copy explains the batch without implying ownership", () => {
  const metadata = {
    postId: "post-1",
    postTitle: "导入的校刊",
    importerDisplayName: "柚子",
    commentCount: 3,
  };

  assert.equal(formatDocxAttributionNotice(metadata), "柚子导入《导入的校刊》时，将 3 条 Word 批注关联到了你。此关联仅用于显示来源身份，不授予编辑或删除权限。");
  assert.equal(formatDocxAttributionNotice(metadata, { includePostTitle: false }), "柚子导入一篇帖子时，将 3 条 Word 批注关联到了你。此关联仅用于显示来源身份，不授予编辑或删除权限。");
  assert.equal(parseDocxAttributionNoticeMetadata("{}"), null);
  assert.equal(parseDocxAttributionNoticeMetadata("not-json"), null);
});
