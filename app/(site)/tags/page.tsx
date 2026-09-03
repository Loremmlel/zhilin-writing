import Link from "next/link";

import { listTags } from "@/db/queries";

export default async function TagsPage() {
  const tags = await listTags();
  return (
    <div className="page-column">
      <header className="page-header">
        <span className="eyebrow">标签</span>
        <h1>从一个话题开始阅读</h1>
        <p>标签只是轻量的阅读入口，不承担分类层级。</p>
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
          <h2>还没有标签</h2>
          <p>成员发帖时可以创建第一个标签。</p>
        </div>
      )}
    </div>
  );
}
