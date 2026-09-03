import Link from "next/link";

import { listPosts, listTags } from "@/db/queries";
import { PostCard } from "@/components/post-card";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const active = sort === "active";
  const [items, tags] = await Promise.all([
    listPosts({ sort: active ? "active" : "latest" }),
    listTags(),
  ]);
  return (
    <div className="home-page page-column">
      <section className="home-intro">
        <div>
          <span className="eyebrow">只对受邀成员开放</span>
          <h1>近来写下的文字</h1>
        </div>
        <p>在文字里，我们彼此靠近。这里是安静写作、耐心阅读和友善交流的地方。</p>
      </section>
      <nav className="list-tabs" aria-label="帖子排序">
        <Link href="/" className={!active ? "is-active" : ""}>
          最新
        </Link>
        <Link href="/?sort=active" className={active ? "is-active" : ""}>
          活跃
        </Link>
        <Link href="/tags" className="tab-spacer">
          浏览标签
        </Link>
      </nav>
      {items.length > 0 ? (
        <section className="post-list" aria-label={active ? "活跃帖子" : "最新帖子"}>
          {items.map((item) => (
            <PostCard key={item.post.id} {...item} />
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <h2>这里还很安静</h2>
          <p>写下第一篇帖子，让这个小社区有一个开头。</p>
          <Link className="button button--primary" href="/posts/new">
            写第一篇帖子
          </Link>
        </section>
      )}
      {tags.length > 0 && (
        <section className="home-tag-strip" aria-label="最近标签">
          <span>最近使用的标签</span>
          {tags.slice(0, 8).map((tag) => (
            <Link
              className="tag"
              href={`/tags/${encodeURIComponent(tag.normalizedName)}`}
              key={tag.id}
            >
              {tag.name}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
