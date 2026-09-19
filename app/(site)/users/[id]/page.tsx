import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Avatar } from "@/components/avatar";
import { PostCard } from "@/components/post-card";
import Link from "next/link";

import { ActivityList } from "@/components/activity-list";
import { ProfileContentSkeleton } from "@/components/loading/skeletons";
import { RegionErrorBoundary } from "@/components/region-error-boundary";
import { findUserById, listPostsPage, listUserActivityPage } from "@/db/queries";
import { formatJoinedDate } from "@/lib/format";

import { Pagination } from "@/components/pagination";
import { parsePage } from "@/lib/pagination";
import { canonicalPage } from "@/lib/page-navigation";
import { requireMember } from "@/lib/auth/access";
export const metadata = { title: "成员主页" };

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = query.tab === "activity" ? "activity" : "posts";
  const [user, { member }] = await Promise.all([findUserById(id), requireMember(`/users/${id}`)]);
  if (!user) notFound();
  return (
    <div className="page-column profile-page">
      <header className="profile-header">
        <Avatar name={user.displayName} assetId={user.avatarAssetId} size="large" />
        <div>
          <h1>{user.displayName}</h1>
          <p>{user.bio || "还没有写个人简介。"}</p>
          <span className="muted">{formatJoinedDate(user.joinedAt)} 加入</span>
        </div>
      </header>
      <nav className="list-tabs profile-tabs" aria-label="个人主页内容">
        <Link
          href={`/users/${id}`}
          className={tab === "posts" ? "is-active" : ""}
          aria-current={tab === "posts" ? "page" : undefined}
        >
          帖子
        </Link>
        <Link
          href={`/users/${id}?tab=activity`}
          className={tab === "activity" ? "is-active" : ""}
          aria-current={tab === "activity" ? "page" : undefined}
        >
          动态
        </Link>
      </nav>
      <RegionErrorBoundary title="个人内容暂时无法载入" description="请稍后重试。">
        <Suspense fallback={<ProfileContentSkeleton />}>
          <ProfileContent
            viewerId={member.id}
            userId={id}
            tab={tab}
            rawPage={query.page}
            own={member.id === id}
          />
        </Suspense>
      </RegionErrorBoundary>
    </div>
  );
}

async function ProfileContent({
  viewerId,
  userId,
  tab,
  rawPage,
  own,
}: {
  viewerId: string;
  userId: string;
  tab: "posts" | "activity";
  rawPage?: string;
  own: boolean;
}) {
  const path = `/users/${userId}`;
  const filters = { tab: tab === "activity" ? "activity" : undefined };
  const result =
    tab === "activity"
      ? await listUserActivityPage(userId, viewerId, parsePage(rawPage))
      : await listPostsPage(viewerId, { authorId: userId, page: parsePage(rawPage) });
  canonicalPage(rawPage, result.page, path, filters);
  return (
    <>
      {tab === "activity" ? (
        result.items.length ? (
          <ActivityList
            items={result.items as Awaited<ReturnType<typeof listUserActivityPage>>["items"]}
          />
        ) : (
          <div className="empty-state">
            <p>暂时没有可见动态。</p>
            <Link className="button button--ghost" href={path}>
              查看该成员的帖子
            </Link>
          </div>
        )
      ) : result.items.length ? (
        <section className="post-list">
          {(result.items as Awaited<ReturnType<typeof listPostsPage>>["items"]).map((item) => (
            <PostCard key={item.post.id} {...item} />
          ))}
        </section>
      ) : (
        <div className="empty-state">
          <p>{own ? "你还没有发布帖子。" : "这位成员还没有可见帖子。"}</p>
          <Link className="button button--ghost" href={own ? "/posts/new" : "/"}>
            {own ? "写帖子" : "浏览帖子"}
          </Link>
        </div>
      )}
      <Pagination {...result} path={path} filters={filters} />
    </>
  );
}
