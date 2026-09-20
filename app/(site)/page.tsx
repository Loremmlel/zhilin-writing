import { requireWritingMember } from "@/lib/auth/access";
import Link from "next/link";
import { listPostsPage } from "@/db/queries";
import { PostCard } from "@/components/post-card";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { parsePage } from "@/lib/pagination";
import { canonicalPage } from "@/lib/page-navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "帖子" };
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; page?: string }>;
}) {
  const { member } = await requireWritingMember("/");
  const params = await searchParams;
  const active = params.sort === "active";
  const filters = { sort: active ? "active" : undefined };
  const result = await listPostsPage(member.id, {
    sort: active ? "active" : "latest",
    page: parsePage(params.page),
  });
  canonicalPage(params.page, result.page, "/", filters);
  return (
    <div className="home-page page-column">
      <PageHeader title="帖子" count={result.total} />
      <nav className="list-tabs" aria-label="帖子排序">
        <Link
          href="/"
          className={!active ? "is-active" : ""}
          aria-current={!active ? "page" : undefined}
        >
          最新
        </Link>
        <Link
          href="/?sort=active"
          className={active ? "is-active" : ""}
          aria-current={active ? "page" : undefined}
        >
          最近活跃
        </Link>
        <Link href="/tags" className="tab-spacer">
          浏览标签
        </Link>
      </nav>
      {result.items.length ? (
        <section className="post-list" aria-label={active ? "活跃帖子" : "最新帖子"}>
          {result.items.map((item) => (
            <PostCard key={item.post.id} {...item} active={active} />
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <p>还没有帖子，写下第一篇吧。</p>
          <Link className="button button--primary" href="/posts/new">
            写帖子
          </Link>
        </section>
      )}
      <Pagination {...result} path="/" filters={filters} />
    </div>
  );
}
