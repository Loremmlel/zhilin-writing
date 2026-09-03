import type { AnnotationId } from "./types.ts";
import {
  collectAnnotationIds,
  hasAnnotationDirective,
  parseAnnotationMarkdown,
} from "./markdown.ts";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const annotationIdPattern =
  /^ann_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const allowedContentNodes = new Set([
  "root",
  "paragraph",
  "blockquote",
  "list",
  "listItem",
  "code",
  "text",
  "strong",
  "emphasis",
  "delete",
  "inlineCode",
  "link",
]);

export function assertOrdinaryPostMarkdown(markdown: string): string {
  if (hasAnnotationDirective(parseAnnotationMarkdown(markdown)))
    throw new Error("不能直接写入正文批注标记");
  return markdown;
}

type ContentNode = { type: string; url?: string; children?: ContentNode[] };

export function createAnnotationId(): AnnotationId {
  return `ann_${crypto.randomUUID()}`;
}

export function validateAnnotationId(value: string): AnnotationId {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!annotationIdPattern.test(normalized)) throw new Error("批注标识无效");
  return normalized as AnnotationId;
}

export function validateAnnotationSubmissionKey(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!uuidV4Pattern.test(normalized)) throw new Error("批注提交标识无效，请刷新页面后重试");
  return normalized;
}

function validateContentNode(node: ContentNode) {
  if (!allowedContentNodes.has(node.type)) throw new Error("批注内容包含不支持的格式");
  if (node.type === "link") {
    const url = node.url ?? "";
    if (url.startsWith("/api/assets/") || /^(?:javascript|data):/i.test(url))
      throw new Error("批注内容不能包含附件或不安全链接");
  }
  node.children?.forEach(validateContentNode);
}

export function validateAnnotationContent(value: string): string {
  const markdown = value.trim();
  if (!markdown) throw new Error("批注内容不能为空");
  if (Array.from(markdown).length > 10_000) throw new Error("批注内容不能超过 10000 个字符");
  validateContentNode(parseAnnotationMarkdown(markdown) as ContentNode);
  return markdown;
}

export const validateAnnotationReplyContent = validateAnnotationContent;

export function getAnnotationMutationPermissions(
  record: {
    sourceType: "NATIVE" | "DOCX_IMPORT";
    authorId: string | null;
    importedByUserId: string | null;
  },
  context: { actorUserId: string; postAuthorId: string },
) {
  return {
    canDelete: record.sourceType === "NATIVE" && record.authorId === context.actorUserId,
    canRemoveImportedThread:
      record.sourceType === "DOCX_IMPORT" &&
      (record.importedByUserId === context.actorUserId ||
        context.postAuthorId === context.actorUserId),
  };
}

export function assertNativeAnnotationMutation(record: {
  sourceType: "NATIVE" | "DOCX_IMPORT";
}): void {
  if (record.sourceType === "DOCX_IMPORT")
    throw new Error("Word 导入内容不可作为站内原生内容编辑或删除");
}

export function sortAnnotationRowsByAnchorPosition<
  T extends { annotation: { id: string; createdAt: Date } },
>(markdown: string, rows: T[]): T[] {
  const position = new Map(
    collectAnnotationIds(parseAnnotationMarkdown(markdown)).map((id, index) => [id, index]),
  );
  return [...rows].sort((a, b) => {
    const byPosition =
      (position.get(a.annotation.id) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(b.annotation.id) ?? Number.MAX_SAFE_INTEGER);
    return (
      byPosition ||
      a.annotation.createdAt.getTime() - b.annotation.createdAt.getTime() ||
      compareOpaqueId(a.annotation.id, b.annotation.id)
    );
  });
}

function compareOpaqueId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type AnnotationReplySortRecord = {
  id: string;
  sourceType: "NATIVE" | "DOCX_IMPORT";
  sourceCreatedAt: Date | null;
  sourceDocumentOrder: number | null;
  sourceCommentId: string | null;
  createdAt: Date;
};

export function sortAnnotationReplyRows<T extends { reply: AnnotationReplySortRecord }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const left = a.reply;
    const right = b.reply;
    if (left.sourceType === "DOCX_IMPORT" && right.sourceType === "DOCX_IMPORT") {
      const bySourceTime =
        (left.sourceCreatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.sourceCreatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
      if (bySourceTime) return bySourceTime;
      const byDocumentOrder =
        (left.sourceDocumentOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.sourceDocumentOrder ?? Number.MAX_SAFE_INTEGER);
      if (byDocumentOrder) return byDocumentOrder;
      const bySourceId = compareOpaqueId(left.sourceCommentId ?? "", right.sourceCommentId ?? "");
      if (bySourceId) return bySourceId;
    }
    return (
      left.createdAt.getTime() - right.createdAt.getTime() || compareOpaqueId(left.id, right.id)
    );
  });
}

export function resolveAnnotationReplyRecipient(input: {
  actorUserId: string;
  annotationAuthorId: string | null;
  replyToUserId: string | null;
}): string | null {
  const recipientUserId = input.replyToUserId ?? input.annotationAuthorId;
  return recipientUserId === input.actorUserId ? null : recipientUserId;
}

export function assertAnchorInvariant(markdownIds: string[], anchorIds: string[]): void {
  const markdown = [...markdownIds].sort();
  const anchors = [...anchorIds].sort();
  const same =
    markdown.length === new Set(markdown).size &&
    anchors.length === new Set(anchors).size &&
    markdown.length === anchors.length &&
    markdown.every((id, index) => id === anchors[index]);
  if (!same) throw new Error("正文批注锚点状态不一致");
}

export function assertAnnotationBelongsToPost(actualPostId: string, expectedPostId: string): void {
  if (actualPostId !== expectedPostId) throw new Error("批注不存在或不属于当前帖子");
}
