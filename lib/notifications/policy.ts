export type DocxAttributionNoticeMetadata = {
  postId: string;
  postTitle: string;
  importerDisplayName: string;
  commentCount: number;
};

export type DocxAttributionNotice = {
  id: string;
  recipientUserId: string;
  actorUserId: string;
  eventId: string;
  notificationType: "DOCX_ATTRIBUTION_NOTICE";
  postId: string;
  replyId: null;
  annotationId: null;
  annotationReplyId: null;
  metadataJson: string;
  importBatchId: string;
  createdAt: number;
  readAt: null;
};

export function buildDocxAttributionNotices(input: {
  importBatchId: string;
  eventId: string;
  postId: string;
  postTitle: string;
  importerUserId: string;
  importerDisplayName: string;
  createdAt: Date | number;
  attributedUserIds: readonly (string | null)[];
}): DocxAttributionNotice[] {
  const counts = new Map<string, number>();
  for (const recipient of input.attributedUserIds) {
    if (recipient && recipient !== input.importerUserId) {
      counts.set(recipient, (counts.get(recipient) ?? 0) + 1);
    }
  }
  const createdAt = input.createdAt instanceof Date ? input.createdAt.getTime() : input.createdAt;
  return [...counts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([recipientUserId, commentCount]) => ({
    id: `notification:${input.eventId}:${recipientUserId}:docx-attribution-notice`,
    recipientUserId,
    actorUserId: input.importerUserId,
    eventId: input.eventId,
    notificationType: "DOCX_ATTRIBUTION_NOTICE",
    postId: input.postId,
    replyId: null,
    annotationId: null,
    annotationReplyId: null,
    metadataJson: JSON.stringify({
      postId: input.postId,
      postTitle: input.postTitle,
      importerDisplayName: input.importerDisplayName,
      commentCount,
    } satisfies DocxAttributionNoticeMetadata),
    importBatchId: input.importBatchId,
    createdAt,
    readAt: null,
  }));
}

export function parseDocxAttributionNoticeMetadata(value: string | null): DocxAttributionNoticeMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DocxAttributionNoticeMetadata>;
    if (
      typeof parsed.postId !== "string" || !parsed.postId
      || typeof parsed.postTitle !== "string" || !parsed.postTitle
      || typeof parsed.importerDisplayName !== "string" || !parsed.importerDisplayName
      || !Number.isInteger(parsed.commentCount) || (parsed.commentCount ?? 0) <= 0
    ) return null;
    return parsed as DocxAttributionNoticeMetadata;
  } catch {
    return null;
  }
}

export function formatDocxAttributionNotice(
  metadata: DocxAttributionNoticeMetadata,
  options: { includePostTitle?: boolean } = {},
): string {
  const target = options.includePostTitle === false ? "一篇帖子" : `《${metadata.postTitle}》`;
  return `${metadata.importerDisplayName}导入${target}时，将 ${metadata.commentCount} 条 Word 批注关联到了你。此关联仅用于显示来源身份，不授予编辑或删除权限。`;
}
