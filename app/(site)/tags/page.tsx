import Link from "next/link";

import { listTags } from "@/db/queries";

export const metadata = { title: "标签" };

export default async function TagsPage() {
  const tags = await listTags();
  return (
    <div className="page-column">
      <header className="page-header">
        <div>
          <h1>标签</h1>
        </div>
      </header>
      {tags.length > 0 ? (
        <div className="tag-grid">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/tags/${encodeURIComponent(tag.normalizedName)}`}
              className="tag-card"
            >
              <strong>{tag.name}</strong>
              <span>{tag.postCount} 篇帖子</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>还没有使用过的标签。</p>
          <Link className="button button--ghost" href="/">
            浏览帖子
          </Link>
        </div>
      )}
    </div>
  );
}
