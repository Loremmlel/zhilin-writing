import { notFound } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { PostCard } from "@/components/post-card";
import { findUserById, listPosts } from "@/db/queries";
import { formatJoinedDate } from "@/lib/format";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, items] = await Promise.all([findUserById(id), listPosts({ authorId: id })]);
  if (!user) notFound();
  return (
    <div className="page-column profile-page">
      <header className="profile-header">
        <Avatar name={user.displayName} assetId={user.avatarAssetId} size="large" />
        <div><span className="eyebrow">社区成员</span><h1>{user.displayName}</h1><p>{user.bio || "还没有写个人简介。"}</p><span className="muted">{formatJoinedDate(user.joinedAt)} 加入</span></div>
      </header>
      <div className="section-heading"><h2>发布的帖子</h2><span>{items.length} 篇</span></div>
      {items.length > 0 ? <section className="post-list">{items.map((item) => <PostCard key={item.post.id} {...item} />)}</section> : <div className="empty-state"><h2>还没有发布帖子</h2><p>这里会显示这位成员当前可见的文章。</p></div>}
    </div>
  );
}
