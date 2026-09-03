import { PostCard } from "@/components/post-card";
import { listPosts } from "@/db/queries";

export default async function TagPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const items = await listPosts({ tagName: decoded });
  const displayName =
    items[0]?.tags.find((tag) => tag.normalizedName === decoded.toLocaleLowerCase("zh-CN"))?.name ??
    decoded;
  return (
    <div className="page-column">
      <header className="page-header">
        <span className="eyebrow">标签</span>
        <h1>{displayName}</h1>
        <p>{items.length} 篇当前可见的帖子</p>
      </header>
      {items.length > 0 ? (
        <section className="post-list">
          {items.map((item) => (
            <PostCard key={item.post.id} {...item} />
          ))}
        </section>
      ) : (
        <div className="empty-state">
          <h2>没有找到帖子</h2>
          <p>这个标签暂时没有可见内容。</p>
        </div>
      )}
    </div>
  );
}
