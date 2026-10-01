import Link from "next/link";

import type { PostRecord, SiteUser } from "@/db/schema";
import { excerpt, formatDateTime, formatListDateTime } from "@/lib/format";
import { Avatar } from "./avatar";
import { ProfileLink } from "./profile-link";

type PostCardProps = {
  post: Pick<
    PostRecord,
    "id" | "title" | "searchText" | "markdown" | "publishedAt" | "lastActivityAt" | "editedAt"
  >;
  author: SiteUser;
  tags: { id: string; name: string; normalizedName: string }[];
  replyCount: number;
  annotationCount: number;
  active?: boolean;
};

export function PostCard({
  post,
  author,
  tags,
  replyCount,
  annotationCount,
  active = false,
}: PostCardProps) {
  return (
    <article className="post-card">
      <div className="post-card-content">
        <Link href={`/posts/${post.id}`} className="post-title-link">
          <h2>{post.title}</h2>
        </Link>
        <p className="post-excerpt">{excerpt(post.searchText || post.markdown)}</p>
        <div className="post-meta">
          <span className="author-link">
            <ProfileLink userId={author.id} name={author.displayName} avatar>
              <Avatar name={author.displayName} assetId={author.avatarAssetId} size="small" />
            </ProfileLink>
            <ProfileLink userId={author.id} name={author.displayName}>
              {author.displayName}
            </ProfileLink>
          </span>
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
          <div className="post-counts">
            <Link
              href={`/posts/${post.id}`}
              className="post-count annotation-count"
              aria-label={`${annotationCount} 条批注`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6l-5 3v-3a3 3 0 0 1-2-3V7a3 3 0 0 1 3-3Z" />
                <path d="M8 9h8M8 13h5" />
              </svg>
              {annotationCount}
            </Link>
            <Link
              href={`/posts/${post.id}#replies`}
              className="post-count reply-count"
              aria-label={`${replyCount} 条回复`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 15a4 4 0 0 1-4 4H8l-4 3V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4Z" />
              </svg>
              {replyCount}
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
