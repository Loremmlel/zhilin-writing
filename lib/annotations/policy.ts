import type { AnnotationId } from "./types.ts";
import { hasAnnotationDirective, parseAnnotationMarkdown } from "./markdown.ts";

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const annotationIdPattern = /^ann_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const allowedContentNodes = new Set(["root", "paragraph", "blockquote", "list", "listItem", "code", "text", "strong", "emphasis", "delete", "inlineCode", "link"]);

export const ANNOTATED_POST_EDIT_MESSAGE = "此帖子已有正文批注。批注正文编辑保护将在下一版本完成，因此当前暂时不能编辑已批注正文。";

export function canOpenPostEditor(currentAnchorCount: number): boolean { return currentAnchorCount === 0; }

export function assertOrdinaryPostMarkdown(markdown: string): string {
  if (hasAnnotationDirective(parseAnnotationMarkdown(markdown))) throw new Error("不能直接写入正文批注标记");
  return markdown;
}

type ContentNode = { type: string; url?: string; children?: ContentNode[] };

export function createAnnotationId(): AnnotationId { return `ann_${crypto.randomUUID()}`; }

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
    if (url.startsWith("/api/assets/") || /^(?:javascript|data):/i.test(url)) throw new Error("批注内容不能包含附件或不安全链接");
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

export function resolveAnnotationReplyRecipient(input: { actorUserId: string; annotationAuthorId: string | null; replyToUserId: string | null }): string | null {
  const recipientUserId = input.replyToUserId ?? input.annotationAuthorId;
  return recipientUserId === input.actorUserId ? null : recipientUserId;
}

export function assertAnchorInvariant(markdownIds: string[], anchorIds: string[]): void {
  const markdown = [...markdownIds].sort();
  const anchors = [...anchorIds].sort();
  const same = markdown.length === new Set(markdown).size
    && anchors.length === new Set(anchors).size
    && markdown.length === anchors.length
    && markdown.every((id, index) => id === anchors[index]);
  if (!same) throw new Error("正文批注锚点状态不一致");
}

export function assertAnnotationBelongsToPost(actualPostId: string, expectedPostId: string): void {
  if (actualPostId !== expectedPostId) throw new Error("批注不存在或不属于当前帖子");
}
