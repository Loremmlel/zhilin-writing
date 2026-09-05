import Link from "next/link";

import type { PostRecord, SiteUser } from "@/db/schema";
import { excerpt, formatDateTime, formatListDateTime } from "@/lib/format";
import { Avatar } from "./avatar";

type PostCardProps = {
  post: PostRecord;
  author: SiteUser;
  tags: { id: string; name: string; normalizedName: string }[];
  replyCount: number;
  active?: boolean;
};

export function PostCard({ post, author, tags, replyCount, active = false }: PostCardProps) {
  return (
    <article className="post-card">
      <div className="post-card-content">
        <Link href={`/posts/${post.id}`} className="post-title-link">
          <h2>{post.title}</h2>
        </Link>
        <p className="post-excerpt">{excerpt(post.searchText || post.markdown)}</p>
        <div className="post-meta">
          <Link href={`/users/${author.id}`} className="author-link">
            <Avatar name={author.displayName} assetId={author.avatarAssetId} size="small" />
            <span>{author.displayName}</span>
          </Link>
          <time
            dateTime={(active ? post.lastActivityAt : post.publishedAt).toISOString()}
            title={`发表于 ${formatDateTime(post.publishedAt)}${active ? `；活跃于 ${formatDateTime(post.lastActivityAt)}` : ""}`}
            aria-label={`${active ? "活跃于" : "发表于"} ${formatDateTime(active ? post.lastActivityAt : post.publishedAt)}`}
          >
            {active && "活跃于 "}
            {formatListDateTime(active ? post.lastActivityAt : post.publishedAt)}
          </time>
          {post.editedAt && <span>（已编辑）</span>}
          {tags.length > 0 && (
            <div className="post-tags">
              {tags.map((tag) => (
                <Link
                  key={tag.id}
                  href={`/tags/${encodeURIComponent(tag.normalizedName)}`}
                  className="tag"
                >
                  {tag.name}
                </Link>
              ))}
            </div>
          )}
          <Link
            href={`/posts/${post.id}#replies`}
            className="reply-count"
            aria-label={`${replyCount} 条回复`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 15a4 4 0 0 1-4 4H8l-4 3V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4Z" />
            </svg>
            {replyCount}
          </Link>
        </div>
      </div>
    </article>
  );
}
