import { requireWritingMember } from "@/lib/auth/access";
import Link from "next/link";
import { PostCard } from "@/components/post-card";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { listPostsPage } from "@/db/queries";
import { parsePage } from "@/lib/pagination";
import { canonicalPage } from "@/lib/page-navigation";
export const metadata = { title: "标签帖子" };
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { member } = await requireWritingMember("/tags");
  const [{ name }, query] = await Promise.all([params, searchParams]);
  const decoded = decodeURIComponent(name);
  const path = `/tags/${encodeURIComponent(decoded)}`;
  const result = await listPostsPage(member.id, { tagName: decoded, page: parsePage(query.page) });
  canonicalPage(query.page, result.page, path);
  const displayName =
    result.items[0]?.tags.find((tag) => tag.normalizedName === decoded.toLocaleLowerCase("zh-CN"))
      ?.name ?? decoded;
  return (
    <div className="page-column">
      <PageHeader
        title={displayName}
        count={result.total}
        actions={
          <Link className="button button--ghost" href="/tags">
            全部标签
          </Link>
        }
      />
      {result.items.length ? (
        <section className="post-list" aria-label="标签帖子">
          {result.items.map((item) => (
            <PostCard key={item.post.id} {...item} />
          ))}
        </section>
      ) : (
        <div className="empty-state">
          <p>这个标签下还没有可见帖子。</p>
          <Link className="button button--ghost" href="/tags">
            浏览全部标签
          </Link>
        </div>
      )}
      <Pagination {...result} path={path} />
    </div>
  );
}
