import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Avatar } from "@/components/avatar";
import { PostCard } from "@/components/post-card";
import Link from "next/link";

import { ActivityList } from "@/components/activity-list";
import { ProfileContentSkeleton } from "@/components/loading/skeletons";
import { RegionErrorBoundary } from "@/components/region-error-boundary";
import { findUserById, listPosts, listUserActivity } from "@/db/queries";
import { formatJoinedDate } from "@/lib/format";

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = query.tab === "activity" ? "activity" : "posts";
  const user = await findUserById(id);
  if (!user) notFound();
  return (
    <div className="page-column profile-page">
      <header className="profile-header">
        <Avatar name={user.displayName} assetId={user.avatarAssetId} size="large" />
        <div>
          <span className="eyebrow">社区成员</span>
          <h1>{user.displayName}</h1>
          <p>{user.bio || "还没有写个人简介。"}</p>
          <span className="muted">{formatJoinedDate(user.joinedAt)} 加入</span>
        </div>
      </header>
      <nav className="list-tabs profile-tabs" aria-label="个人主页内容">
        <Link href={`/users/${id}`} className={tab === "posts" ? "is-active" : ""}>
          帖子
        </Link>
        <Link href={`/users/${id}?tab=activity`} className={tab === "activity" ? "is-active" : ""}>
          动态
        </Link>
      </nav>
      <RegionErrorBoundary
        title="个人内容暂时无法载入"
        description="当前标签页仍会保留，请稍后重试。"
      >
        <Suspense fallback={<ProfileContentSkeleton />}>
          <ProfileContent userId={id} tab={tab} />
        </Suspense>
      </RegionErrorBoundary>
    </div>
  );
}

async function ProfileContent({ userId, tab }: { userId: string; tab: "posts" | "activity" }) {
  if (tab === "activity") return <ActivityList items={await listUserActivity(userId)} />;
  const posts = await listPosts({ authorId: userId });
  return posts.length > 0 ? (
    <section className="post-list">
      {posts.map((item) => (
        <PostCard key={item.post.id} {...item} />
      ))}
    </section>
  ) : (
    <div className="empty-state">
      <h2>还没有发布帖子</h2>
      <p>这里会显示这位成员当前可见的文章。</p>
    </div>
  );
}
