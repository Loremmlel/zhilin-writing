import { parseAnnotationMarkdown } from "../annotations/markdown.ts";
import { formattingIsValid } from "../markdown/formatting.ts";
import { validateAssetUpload } from "../assets/upload-policy.ts";

export type PostInput = {
  title: string;
  markdown: string;
  tags: string[];
};

export class PostInputError extends Error {
  readonly field: keyof PostInput;

  constructor(message: string, field: keyof PostInput) {
    super(message);
    this.name = "PostInputError";
    this.field = field;
  }
}

export type ReplyTarget = {
  id: string;
  rootReplyId: string | null;
  authorId: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

export function validateDisplayName(value: string): string | null {
  const name = value.trim();
  if (!name) return "显示名称不能为空";
  if (Array.from(name).length > 30) return "显示名称不能超过 30 个字符";
  return null;
}

export function validatePostInput(input: PostInput): PostInput {
  const title = input.title.trim();
  const markdown = input.markdown.trim();
  const tags = input.tags.map((tag) => tag.trim()).filter(Boolean);

  if (!title) throw new PostInputError("标题不能为空", "title");
  if (Array.from(title).length > 120) throw new PostInputError("标题不能超过 120 个字符", "title");
  if (!markdown) throw new PostInputError("正文不能为空", "markdown");
  if (!formattingIsValid(parseAnnotationMarkdown(markdown)))
    throw new PostInputError("正文格式无效，请恢复默认格式后重试", "markdown");
  if (tags.length > 5) throw new PostInputError("最多选择 5 个标签", "tags");

  const normalized = tags.map((tag) => tag.toLocaleLowerCase("zh-CN"));
  if (new Set(normalized).size !== normalized.length) {
    throw new PostInputError("标签不能重复", "tags");
  }

  if (tags.some((tag) => Array.from(tag).length > 24)) {
    throw new PostInputError("标签不能超过 24 个字符", "tags");
  }

  return { title, markdown, tags };
}

export function canEditPost(authorId: string, currentUserId: string): boolean {
  return authorId === currentUserId;
}

export function validateReplyMarkdown(value: string): string {
  const markdown = value.trim();
  if (!markdown) throw new Error("回复不能为空");
  if (Array.from(markdown).length > 10_000) {
    throw new Error("回复不能超过 10000 个字符");
  }
  return markdown;
}

export function normalizeReplyTarget(target: ReplyTarget): {
  rootReplyId: string;
  replyToReplyId: string;
  replyToUserId: string;
} {
  return {
    rootReplyId: target.rootReplyId ?? target.id,
    replyToReplyId: target.id,
    replyToUserId: target.authorId,
  };
}

export function draftKey(userId: string, postId: string): string {
  return `zhilin:draft:${userId}:${postId}`;
}

export function classifyUpload(mimeType: string): "image" | "attachment" {
  return mimeType.toLocaleLowerCase("en-US").startsWith("image/") ? "image" : "attachment";
}

export function assetMarkdown(asset: {
  kind: "image" | "attachment";
  filename: string;
  url: string;
}): string {
  const label = asset.filename.replace(/[\[\]]/g, "");
  return asset.kind === "image" ? `![${label}](${asset.url})` : `[${label}](${asset.url})`;
}

export function validateUpload(file: { size: number; mimeType: string }): string | null {
  return validateAssetUpload(file)?.message ?? null;
}
