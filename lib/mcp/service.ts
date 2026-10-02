import { Buffer } from "node:buffer";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { assets, postAssetRefs, posts } from "@/db/schema";
import { findAllowedMember, getPostDetail, listPostsPage, listReplies } from "@/db/queries";
import { listCurrentAnnotationThreads } from "@/lib/annotations/queries";
import { getStoredObject } from "@/lib/assets/storage";
import { postVisibilityCondition } from "@/lib/posts/visibility";
import { McpToolError, resolveMcpAccess, textResult, type McpAccess } from "./protocol";

export function getMcpWritingAccess(headers: Headers) {
  // null disables administrator bootstrap/repair: MCP performs no business writes.
  return resolveMcpAccess(headers, (email) => findAllowedMember(email, null));
}

const authorView = (author: { id: string | null; displayName: string }) => ({
  id: author.id,
  displayName: author.displayName,
});

const imageView = (image: {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}) => ({
  id: image.id,
  filename: image.filename,
  mimeType: image.mimeType,
  byteSize: image.byteSize,
});

function paginate<T>(items: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    page: current,
    pageSize,
    hasMore: current < pages,
  };
}

async function requirePost(postId: string, access: McpAccess) {
  const post = await getPostDetail(postId, access.member.id);
  if (!post || !post.lifecycle.discussionReachable)
    throw new McpToolError("随笔不存在或不可访问。");
  return post;
}

function currentImages(postId: string, viewerId: string, assetId?: string) {
  return getDb()
    .select({
      id: assets.id,
      filename: assets.filename,
      mimeType: assets.mimeType,
      byteSize: assets.byteSize,
      r2Key: assets.r2Key,
    })
    .from(postAssetRefs)
    .innerJoin(assets, eq(postAssetRefs.assetId, assets.id))
    .innerJoin(posts, eq(postAssetRefs.postId, posts.id))
    .where(
      and(
        eq(posts.id, postId),
        postVisibilityCondition(viewerId),
        isNull(posts.deletedAt),
        isNull(posts.hiddenAt),
        isNull(assets.deletedAt),
        eq(assets.status, "permanent"),
        eq(assets.kind, "image"),
        assetId ? eq(assets.id, assetId) : undefined,
      ),
    )
    .orderBy(assets.id);
}

export async function callMcpTool(name: string, args: Record<string, unknown>, access: McpAccess) {
  if (name === "get_access_info")
    return textResult({
      user: authorView(access.member),
      isAdmin: access.allowed.isAdmin,
      permissionGroup: access.allowed.permissionGroup,
      readOnly: true,
    });
  if (name === "list_posts" || name === "search_posts") {
    const result = await listPostsPage(
      access.member.id,
      args as Parameters<typeof listPostsPage>[1],
    );
    return textResult({
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.page * result.pageSize < result.total,
      items: result.items.map((row) => ({
        id: row.post.id,
        title: row.post.title,
        excerpt: row.post.searchText.slice(0, 150),
        author: authorView(row.author),
        publishedAt: row.post.publishedAt,
        editedAt: row.post.editedAt,
        tags: row.tags.map((tag) => tag.name),
        commentCount: row.replyCount,
        annotationCount: row.annotationCount,
        path: `/posts/${row.post.id}`,
      })),
    });
  }
  const postId = args.postId as string;
  const post = await requirePost(postId, access);
  if (name === "get_post_content") {
    const markdown = post.markdown ?? "";
    const offset = args.offset as number;
    if (offset > markdown.length) throw new McpToolError("正文offset超过长度。");
    let end = Math.min(markdown.length, offset + (args.limit as number));
    // Keep supplementary characters intact while retaining UTF-16 offsets.
    if (end < markdown.length && /[\uD800-\uDBFF]/.test(markdown[end - 1])) end++;
    const imageRows = post.lifecycle.contentVisible
      ? await currentImages(postId, access.member.id)
      : [];
    return textResult({
      postId,
      title: post.title,
      author: authorView(post.author),
      publishedAt: post.post.publishedAt,
      editedAt: post.post.editedAt,
      revisionId: post.post.currentRevisionId,
      state: post.lifecycle.state,
      placeholder: post.lifecycle.placeholder,
      tags: post.tags.map((tag) => tag.name),
      markdown: markdown.slice(offset, end),
      offset,
      totalCharacters: markdown.length,
      nextOffset: end < markdown.length ? end : null,
      images: imageRows.map(imageView),
    });
  }
  if (name === "list_post_images" || name === "get_image") {
    const rows = await currentImages(
      postId,
      access.member.id,
      name === "get_image" ? (args.assetId as string) : undefined,
    );
    if (name === "list_post_images")
      return textResult({
        postId,
        ...paginate(rows.map(imageView), args.page as number, args.pageSize as number),
      });
    const image = rows[0];
    if (!image) throw new McpToolError("图片不存在或不属于这篇可见随笔。");
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(image.mimeType))
      throw new McpToolError("此图片格式暂不支持。");
    if (image.byteSize > 10 * 1024 * 1024) throw new McpToolError("图片超过10 MB，请在网站查看。");
    const object = await getStoredObject(image.r2Key);
    if (!object) throw new McpToolError("图片文件不存在。");
    if (object.size > 10 * 1024 * 1024) throw new McpToolError("图片超过10 MB，请在网站查看。");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ postId, assetId: image.id, filename: image.filename }),
        },
        {
          type: "image",
          mimeType: image.mimeType,
          data: Buffer.from(await object.arrayBuffer()).toString("base64"),
        },
      ],
    };
  }
  if (name === "list_comments") {
    const rows = await listReplies(postId, access.member.id);
    return textResult({
      postId,
      ...paginate(
        rows.map(({ reply, author, lifecycle, replyTo }) => ({
          id: reply.id,
          author: authorView(author),
          markdown: reply.markdown,
          publishedAt: reply.publishedAt,
          rootReplyId: reply.rootReplyId,
          replyToReplyId: reply.replyToReplyId,
          replyTo: replyTo ? authorView(replyTo) : null,
          state: lifecycle.state,
          placeholder: lifecycle.placeholder,
        })),
        args.page as number,
        args.pageSize as number,
      ),
    });
  }
  const threads = await listCurrentAnnotationThreads(postId, access.member.id);
  if (name === "list_annotations")
    return textResult({
      postId,
      ...paginate(
        threads.map(({ annotation, author, lifecycle, replies }) => ({
          id: annotation.id,
          author,
          selectedText:
            post.lifecycle.contentVisible && lifecycle.contentVisible
              ? annotation.originalSelectedText
              : null,
          markdown: annotation.contentMarkdown,
          createdAt: annotation.sourceCreatedAt ?? annotation.createdAt,
          state: lifecycle.state,
          placeholder: lifecycle.placeholder,
          replyCount: replies.length,
        })),
        args.page as number,
        args.pageSize as number,
      ),
    });
  if (name === "list_annotation_replies") {
    const thread = threads.find((thread) => thread.annotation.id === args.annotationId);
    if (!thread) throw new McpToolError("批注不存在或不属于这篇随笔的当前版本。");
    return textResult({
      postId,
      annotationId: args.annotationId,
      ...paginate(
        thread.replies.map(({ reply, author, lifecycle, replyTo }) => ({
          id: reply.id,
          author,
          markdown: reply.contentMarkdown,
          createdAt: reply.sourceCreatedAt ?? reply.createdAt,
          replyToReplyId: reply.replyToReplyId,
          replyTo: replyTo ? authorView(replyTo) : null,
          state: lifecycle.state,
          placeholder: lifecycle.placeholder,
        })),
        args.page as number,
        args.pageSize as number,
      ),
    });
  }
  throw new McpToolError("工具不存在。");
}
