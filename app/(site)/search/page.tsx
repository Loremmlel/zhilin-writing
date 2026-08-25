import { PostCard } from "@/components/post-card";
import { listPosts } from "@/db/queries";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const items = query ? await listPosts({ query }) : [];
  return (
    <div className="page-column">
      <header className="page-header"><span className="eyebrow">站内搜索</span><h1>{query ? `“${query}”` : "搜索帖子"}</h1><p>搜索当前帖子标题和正文，不包含回复。</p></header>
      <form action="/search" className="search-page-form"><input className="text-input" name="q" defaultValue={query} placeholder="输入标题或正文中的词语" autoFocus /><button className="button button--primary">搜索</button></form>
      {query && (items.length > 0 ? <section className="post-list">{items.map((item) => <PostCard key={item.post.id} {...item} />)}</section> : <div className="empty-state"><h2>没有找到匹配内容</h2><p>换一个更短或更具体的词试试。</p></div>)}
    </div>
  );
}
