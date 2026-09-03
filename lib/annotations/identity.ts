type AnnotationSourceRecord = {
  sourceType: "NATIVE" | "DOCX_IMPORT";
  authorId: string | null;
  sourceAuthorName: string | null;
  sourceInitials: string | null;
  sourceResolved: boolean | null;
};

type AnnotationUserView = {
  id: string;
  displayName: string;
  avatarAssetId: string | null;
};

export type AnnotationAuthorView = {
  sourceType: "NATIVE" | "DOCX_IMPORT";
  id: string | null;
  displayName: string;
  avatarAssetId: string | null;
  initials: string | null;
  attributedUser: { id: string; displayName: string } | null;
  sourceResolved: boolean;
};

export function buildAnnotationAuthorView(
  record: AnnotationSourceRecord,
  nativeAuthor: AnnotationUserView | null,
  attributedUser: AnnotationUserView | null,
): AnnotationAuthorView {
  if (record.sourceType === "NATIVE") {
    if (!nativeAuthor || nativeAuthor.id !== record.authorId) throw new Error("站内批注作者不存在");
    return {
      sourceType: "NATIVE",
      id: nativeAuthor.id,
      displayName: nativeAuthor.displayName,
      avatarAssetId: nativeAuthor.avatarAssetId,
      initials: null,
      attributedUser: null,
      sourceResolved: false,
    };
  }
  return {
    sourceType: "DOCX_IMPORT",
    id: null,
    displayName: record.sourceAuthorName ?? "Word 作者",
    avatarAssetId: null,
    initials: record.sourceInitials,
    attributedUser: attributedUser
      ? { id: attributedUser.id, displayName: attributedUser.displayName }
      : null,
    sourceResolved: Boolean(record.sourceResolved),
  };
}

export function annotationSourceMetadata(author: AnnotationAuthorView): string | null {
  if (author.sourceType !== "DOCX_IMPORT") return null;
  return [
    "Word 导入",
    author.initials ? `缩写 ${author.initials}` : null,
    author.sourceResolved ? "Word 中已解决" : null,
    author.attributedUser ? `关联 ${author.attributedUser.displayName}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}
