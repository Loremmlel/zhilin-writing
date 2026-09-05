import { PostCard } from "@/components/post-card";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchForm, FocusSearchButton } from "@/components/search-form";
import { listPostsPage } from "@/db/queries";
import { parsePage } from "@/lib/pagination";
import { canonicalPage } from "@/lib/page-navigation";
export const metadata = { title: "搜索帖子" };
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const result = query
    ? await listPostsPage({ query, page: parsePage(params.page) })
    : { items: [], total: 0, page: 1, pageSize: 20 };
  canonicalPage(params.page, result.page, "/search", { q: query });
  return (
    <div className="page-column">
      <PageHeader title="搜索帖子" count={query ? result.total : undefined} />
      <SearchForm query={query} id="post-search" />
      {query ? (
        result.items.length ? (
          <section className="post-list" aria-label="搜索结果">
            {result.items.map((item) => (
              <PostCard key={item.post.id} {...item} />
            ))}
          </section>
        ) : (
          <div className="empty-state">
            <p>没有找到匹配的帖子，试试更短的关键词。</p>
            <FocusSearchButton id="post-search" />
          </div>
        )
      ) : (
        <div className="empty-state">
          <p>输入关键词搜索帖子</p>
        </div>
      )}
      <Pagination {...result} path="/search" filters={{ q: query }} />
    </div>
  );
}
