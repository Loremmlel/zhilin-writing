import type { ReactNode } from "react";

function LoadingShell({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={className} aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function Lines({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-lines">
      {Array.from({ length: count }, (_, index) => (
        <span className="skeleton-block" key={index} />
      ))}
    </div>
  );
}

function Cards({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-card-list">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <Lines count={3} />
        </div>
      ))}
    </div>
  );
}

function PageHeading() {
  return (
    <div className="skeleton-page-heading">
      <span className="skeleton-block skeleton-block--eyebrow" />
      <span className="skeleton-block skeleton-block--title" />
      <span className="skeleton-block skeleton-block--copy" />
    </div>
  );
}

export function PostListSkeleton() {
  return (
    <LoadingShell className="page-column loading-shell" label="正在加载帖子列表">
      <PageHeading />
      <div className="skeleton-tabs">
        <span />
        <span />
        <span />
      </div>
      <Cards />
    </LoadingShell>
  );
}

export function PostDetailSkeleton() {
  return (
    <LoadingShell
      className="reading-page reading-page--annotated page-column loading-shell"
      label="正在加载帖子"
    >
      <PostBodySkeleton />
      <DiscussionSkeleton />
    </LoadingShell>
  );
}

export function PostBodySkeleton() {
  return (
    <article className="post-article skeleton-post" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载正文和批注</span>
      <div aria-hidden="true">
        <div className="skeleton-post-header">
          <span className="skeleton-block skeleton-block--eyebrow" />
          <span className="skeleton-block skeleton-block--hero-title" />
          <span className="skeleton-block skeleton-block--meta" />
        </div>
        <div className="skeleton-reading-layout">
          <Lines count={7} />
          <div className="skeleton-annotation-rail">
            <div className="skeleton-card">
              <Lines count={3} />
            </div>
            <div className="skeleton-card">
              <Lines count={2} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function DiscussionSkeleton() {
  return (
    <section className="skeleton-discussion" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载回复</span>
      <div aria-hidden="true">
        <span className="skeleton-block skeleton-block--section-title" />
        <Cards count={2} />
      </div>
    </section>
  );
}

export function ProfileSkeleton() {
  return (
    <LoadingShell className="page-column profile-page loading-shell" label="正在加载个人主页">
      <div className="skeleton-profile-header">
        <span className="skeleton-block skeleton-block--avatar" />
        <PageHeading />
      </div>
      <ProfileContentSkeleton />
    </LoadingShell>
  );
}

export function ProfileContentSkeleton() {
  return (
    <div className="skeleton-region" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载个人内容</span>
      <div aria-hidden="true">
        <div className="skeleton-tabs">
          <span />
          <span />
        </div>
        <Cards />
      </div>
    </div>
  );
}

export function NotificationsSkeleton() {
  return (
    <LoadingShell className="page-column notifications-page loading-shell" label="正在加载通知">
      <PageHeading />
      <NotificationsListSkeleton />
    </LoadingShell>
  );
}

export function NotificationsListSkeleton() {
  return (
    <div className="skeleton-region" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载通知列表</span>
      <div aria-hidden="true">
        <div className="skeleton-tabs">
          <span />
          <span />
        </div>
        <Cards count={4} />
      </div>
    </div>
  );
}

export function SearchSkeleton() {
  return (
    <LoadingShell className="page-column loading-shell" label="正在加载搜索结果">
      <PageHeading />
      <div className="skeleton-search-bar skeleton-block" />
      <Cards />
    </LoadingShell>
  );
}

export function TagSkeleton() {
  return (
    <LoadingShell className="page-column loading-shell" label="正在加载标签页面">
      <PageHeading />
      <Cards />
    </LoadingShell>
  );
}

export function AdminSkeleton() {
  return (
    <div className="admin-shell admin-loading-shell" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载管理后台</span>
      <div className="admin-sidebar" aria-hidden="true">
        <div className="skeleton-lines">
          {Array.from({ length: 8 }, (_, index) => (
            <span className="skeleton-block" key={index} />
          ))}
        </div>
      </div>
      <div className="admin-shell-main admin-page" aria-hidden="true">
        <PageHeading />
        <div className="admin-workspace">
          <AdminListSkeleton />
          <AdminListSkeleton />
        </div>
      </div>
    </div>
  );
}

export function AdminListSkeleton() {
  return (
    <section className="admin-section skeleton-admin-section" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载管理列表</span>
      <div aria-hidden="true">
        <span className="skeleton-block skeleton-block--section-title" />
        <div className="skeleton-tabs">
          <span />
          <span />
          <span />
        </div>
        <Cards count={3} />
      </div>
    </section>
  );
}

export function RevisionSkeleton() {
  return (
    <div className="admin-shell admin-loading-shell" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载历史版本</span>
      <div className="admin-sidebar" aria-hidden="true">
        <div className="skeleton-lines">
          {Array.from({ length: 8 }, (_, index) => (
            <span className="skeleton-block" key={index} />
          ))}
        </div>
      </div>
      <div className="admin-shell-main admin-page revision-admin-page" aria-hidden="true">
        <PageHeading />
        <div className="revision-admin-layout">
          <AdminListSkeleton />
          <RevisionPreviewSkeleton />
        </div>
      </div>
    </div>
  );
}

export function RevisionPreviewSkeleton() {
  return (
    <main
      className="revision-preview skeleton-revision-preview"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">正在加载版本预览</span>
      <div aria-hidden="true">
        <span className="skeleton-block skeleton-block--title" />
        <Lines count={8} />
      </div>
    </main>
  );
}
