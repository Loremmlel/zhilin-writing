import Link from "next/link";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { AdminSearchForm } from "@/components/admin/admin-search-form";
import { AdminShell, type AdminNavKey } from "@/components/admin/admin-shell";
import { AddAllowlistForm, RemoveAllowlistForm } from "@/components/admin/allowlist-forms";
import { ContentLifecycleControl } from "@/components/admin/content-lifecycle-control";
import { AdminListSkeleton } from "@/components/loading/skeletons";
import { RegionErrorBoundary } from "@/components/region-error-boundary";
import {
  countAdminPostsByStatus,
  countAdminRepliesByStatus,
  listAdminAuditLog,
  listAdminAuditLogPage,
  listAdminPosts,
  listAdminReplies,
  listAllowedUsers,
  listRecentUsers,
  listUsers,
} from "@/db/queries";
import {
  countAdminAnnotationRepliesByStatus,
  countAdminAnnotationsByStatus,
  listAdminAnnotationReplies,
  listAdminAnnotations,
} from "@/lib/annotations/queries";
import { annotationSourceMetadata, type AnnotationAuthorView } from "@/lib/annotations/identity";
import {
  adminUrl,
  parseAdminQuery,
  type AdminContentStatus,
  type AdminContentType,
  type AdminPageResult,
  type AdminStatusCounts,
  type AdminView,
  type RawAdminQuery,
} from "@/lib/admin/query";
import { requireAdministrator } from "@/lib/auth/access";
import { formatDateTime } from "@/lib/format";
import {
  addAllowlistAction,
  moderateAnnotationAction,
  moderateAnnotationReplyAction,
  moderatePostAction,
  moderateReplyAction,
  removeAllowlistAction,
} from "./actions";

export const dynamic = "force-dynamic";

const statusLabels: Record<AdminContentStatus, string> = {
  normal: "正常",
  deleted: "用户已删除",
  hidden: "管理员已隐藏",
};

const contentTypeLabels: Record<AdminContentType, string> = {
  posts: "帖子",
  replies: "回复",
  annotations: "批注",
  "annotation-replies": "批注回复",
};

const auditLabels: Record<string, string> = {
  POST_HIDDEN: "隐藏帖子",
  POST_UNHIDDEN: "取消隐藏帖子",
  POST_RESTORED: "恢复已删除帖子",
  REPLY_HIDDEN: "隐藏回复",
  REPLY_UNHIDDEN: "取消隐藏回复",
  REPLY_RESTORED: "恢复已删除回复",
  REVISION_RESTORED: "恢复帖子历史版本",
  ANNOTATION_HIDDEN: "隐藏批注",
  ANNOTATION_UNHIDDEN: "取消隐藏批注",
  ANNOTATION_REPLY_HIDDEN: "隐藏批注回复",
  ANNOTATION_REPLY_UNHIDDEN: "取消隐藏批注回复",
};

function pageCopy(view: AdminView) {
  if (view.section === "members") {
    return { title: "成员与白名单", description: "管理社区访问资格，并核对成员的注册状态。" };
  }
  if (view.section === "audit") {
    return { title: "操作日志", description: "查看管理员对内容状态和历史版本执行的操作。" };
  }
  if (view.section === "content") {
    return {
      title: `${contentTypeLabels[view.type]}管理`,
      description: "查找内容、核对状态，并执行可追溯的恢复或隐藏操作。",
    };
  }
  return { title: "管理后台", description: "掌握社区内容、成员和管理操作的当前状态。" };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawAdminQuery>;
}): Promise<Metadata> {
  const copy = pageCopy(parseAdminQuery(await searchParams));
  return { title: `${copy.title} | 知临中学` };
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<RawAdminQuery>;
}) {
  const [, rawQuery] = await Promise.all([requireAdministrator("/admin"), searchParams]);
  const view = parseAdminQuery(rawQuery);
  const copy = pageCopy(view);
  const active: AdminNavKey = view.section === "content" ? view.type : view.section;
  const showAside = view.section === "overview" || view.section === "content";

  return (
    <AdminShell active={active}>
      <div className="admin-page">
        <header className="admin-page-header">
          <div>
            <span className="eyebrow">管理员</span>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
        </header>
        <div className={showAside ? "admin-workspace" : "admin-workspace admin-workspace--single"}>
          <main className="admin-workspace-main">
            <RegionErrorBoundary
              title="管理列表暂时无法载入"
              description="当前筛选仍会保留，请稍后重试。"
            >
              <Suspense fallback={<AdminListSkeleton />}>
                <AdminMain view={view} />
              </Suspense>
            </RegionErrorBoundary>
          </main>
          {showAside && <AdminAside />}
        </div>
      </div>
    </AdminShell>
  );
}

async function AdminMain({ view }: { view: AdminView }) {
  if (view.section === "members") return <AdminMembers />;
  if (view.section === "audit") return <AdminAudit view={view} />;
  if (view.section === "content") return <AdminContent view={view} />;
  return <AdminOverview view={view} />;
}

async function AdminOverview({ view }: { view: AdminView }) {
  const counts = await Promise.all([
    countAdminPostsByStatus(),
    countAdminRepliesByStatus(),
    countAdminAnnotationsByStatus(),
    countAdminAnnotationRepliesByStatus(),
  ]);
  const cards: Array<{
    type: AdminContentType;
    label: string;
    mark: string;
    counts: AdminStatusCounts;
  }> = [
    { type: "posts", label: "帖子", mark: "帖", counts: counts[0] },
    { type: "replies", label: "回复", mark: "回", counts: counts[1] },
    { type: "annotations", label: "批注", mark: "批", counts: counts[2] },
    { type: "annotation-replies", label: "批注回复", mark: "答", counts: counts[3] },
  ];
  return (
    <section className="admin-overview" aria-labelledby="admin-overview-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">内容状态</span>
          <h2 id="admin-overview-title">社区概况</h2>
        </div>
        <span>数据实时汇总</span>
      </div>
      <div className="admin-metric-grid">
        {cards.map((card) => (
          <Link
            className="admin-metric-card"
            href={adminUrl(view, {
              section: "content",
              type: card.type,
              status: "normal",
              page: 1,
            })}
            key={card.type}
          >
            <span className="admin-metric-mark" aria-hidden="true">
              {card.mark}
            </span>
            <span className="admin-metric-copy">
              <span>{card.label}</span>
              <strong>{card.counts.normal}</strong>
              <small>正常内容</small>
            </span>
            <span className="admin-metric-states">
              <small>用户已删除 {card.counts.deleted}</small>
              <small>管理员已隐藏 {card.counts.hidden}</small>
            </span>
          </Link>
        ))}
      </div>
      <div className="admin-overview-guidance">
        <strong>状态可以重叠</strong>
        <p>同一条内容可能既被作者删除，又被管理员隐藏；两个数字会分别计入。</p>
      </div>
    </section>
  );
}

async function AdminContent({ view }: { view: AdminView }) {
  const options = { status: view.status, q: view.q, sort: view.sort, page: view.page };
  if (view.type === "posts") {
    const result = await listAdminPosts(options);
    return (
      <ContentFrame view={view} result={result}>
        <PostsTable rows={result.rows} />
      </ContentFrame>
    );
  }
  if (view.type === "replies") {
    const result = await listAdminReplies(options);
    return (
      <ContentFrame view={view} result={result}>
        <RepliesTable rows={result.rows} />
      </ContentFrame>
    );
  }
  if (view.type === "annotations") {
    const result = await listAdminAnnotations(options);
    return (
      <ContentFrame view={view} result={result}>
        <AnnotationsTable rows={result.rows} />
      </ContentFrame>
    );
  }
  const result = await listAdminAnnotationReplies(options);
  return (
    <ContentFrame view={view} result={result}>
      <AnnotationRepliesTable rows={result.rows} />
    </ContentFrame>
  );
}

function ContentFrame<T>({
  view,
  result,
  children,
}: {
  view: AdminView;
  result: AdminPageResult<T>;
  children: ReactNode;
}) {
  return (
    <section className="admin-section admin-content-section">
      <div className="section-heading">
        <h2>{contentTypeLabels[view.type]}列表</h2>
        <span>{result.total} 条</span>
      </div>
      <nav className="list-tabs list-tabs--secondary" aria-label="内容状态">
        {(Object.keys(statusLabels) as AdminContentStatus[]).map((status) => (
          <Link
            key={status}
            href={adminUrl(view, { status, page: 1 })}
            className={view.status === status ? "is-active" : ""}
            aria-current={view.status === status ? "page" : undefined}
          >
            {statusLabels[status]}
          </Link>
        ))}
      </nav>
      <AdminSearchForm
        type={view.type}
        status={view.status}
        query={view.q}
        sort={view.sort}
        clearHref={adminUrl(view, { q: "", page: 1 })}
      />
      {result.total > 0 ? (
        <>
          <p className="admin-table-hint">可左右滑动查看完整表格</p>
          <div className="admin-table-scroll">{children}</div>
        </>
      ) : (
        <p className="empty-copy">{adminEmptyCopy(view.type, view.status, view.q)}</p>
      )}
      <Pagination view={view} total={result.total} page={result.page} pageSize={result.pageSize} />
    </section>
  );
}

function adminEmptyCopy(type: AdminContentType, status: AdminContentStatus, query: string) {
  if (query) return `没有找到包含“${query}”的${contentTypeLabels[type]}。`;
  if (status === "deleted") return `没有被作者删除的${contentTypeLabels[type]}。`;
  if (status === "hidden") return `没有被管理员隐藏的${contentTypeLabels[type]}。`;
  return `没有处于正常状态的${contentTypeLabels[type]}。`;
}

function Pagination({
  view,
  total,
  page,
  pageSize,
}: {
  view: AdminView;
  total: number;
  page: number;
  pageSize: number;
}) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="admin-pagination">
      <span>
        显示 {start}–{end}，共 {total} 条
      </span>
      <nav aria-label="列表分页">
        {page > 1 ? (
          <Link href={adminUrl(view, { page: page - 1 })}>上一页</Link>
        ) : (
          <span>上一页</span>
        )}
        <strong aria-current="page">
          {page} / {pageCount}
        </strong>
        {page < pageCount ? (
          <Link href={adminUrl(view, { page: page + 1 })}>下一页</Link>
        ) : (
          <span>下一页</span>
        )}
      </nav>
    </div>
  );
}

function LifecyclePills({
  record,
  post,
  current,
}: {
  record: { deletedAt: Date | null; hiddenAt: Date | null };
  post?: { deletedAt: Date | null; hiddenAt: Date | null };
  current?: boolean;
}) {
  return (
    <div className="status-line">
      {!record.deletedAt && !record.hiddenAt && (
        <span className="status-pill status-pill--normal">正常</span>
      )}
      {record.deletedAt && <span className="status-pill status-pill--deleted">用户已删除</span>}
      {record.hiddenAt && <span className="status-pill status-pill--hidden">管理员已隐藏</span>}
      {post?.deletedAt && (
        <span className="status-pill status-pill--deleted">所属帖子：用户已删除</span>
      )}
      {post?.hiddenAt && (
        <span className="status-pill status-pill--hidden">所属帖子：管理员已隐藏</span>
      )}
      {current === true && <span className="status-pill status-pill--current">当前版本</span>}
      {current === false && <span className="status-pill status-pill--retired">不在当前版本</span>}
    </div>
  );
}

function MarkdownDisclosure({ markdown }: { markdown: string }) {
  return (
    <details className="admin-content-preview">
      <summary>查看原始 Markdown</summary>
      <pre>{markdown}</pre>
    </details>
  );
}

function excerpt(markdown: string) {
  const compact = markdown.replace(/\s+/g, " ").trim();
  return compact ? (compact.length > 96 ? `${compact.slice(0, 96)}…` : compact) : "（空内容）";
}

function PostsTable({ rows }: { rows: Awaited<ReturnType<typeof listAdminPosts>>["rows"] }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th scope="col">帖子</th>
          <th scope="col">作者</th>
          <th scope="col">状态</th>
          <th scope="col">时间</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ post, author }) => (
          <tr key={post.id}>
            <td>
              <strong>{post.title}</strong>
              {post.hiddenReason && <small>隐藏原因：{post.hiddenReason}</small>}
            </td>
            <td>{author.displayName}</td>
            <td>
              <LifecyclePills record={post} />
            </td>
            <td>
              <span>{formatDateTime(post.publishedAt)}</span>
              {post.editedAt && <small>编辑于 {formatDateTime(post.editedAt)}</small>}
            </td>
            <td>
              <div className="admin-table-actions">
                <Link className="text-link" href={`/posts/${post.id}`}>
                  查看
                </Link>
                <Link className="text-link" href={`/admin/revisions/${post.id}`}>
                  Post revisions
                </Link>
                {post.deletedAt && (
                  <ContentLifecycleControl
                    key={`post-${post.id}-restore-${post.deletedAt.getTime()}`}
                    action={moderatePostAction.bind(null, post.id, "restore")}
                    operation="restore"
                    targetLabel="帖子"
                  />
                )}
                {post.hiddenAt ? (
                  <ContentLifecycleControl
                    key={`post-${post.id}-unhide-${post.hiddenAt.getTime()}`}
                    action={moderatePostAction.bind(null, post.id, "unhide")}
                    operation="unhide"
                    targetLabel="帖子"
                  />
                ) : (
                  <ContentLifecycleControl
                    key={`post-${post.id}-hide`}
                    action={moderatePostAction.bind(null, post.id, "hide")}
                    operation="hide"
                    targetLabel="帖子"
                  />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RepliesTable({ rows }: { rows: Awaited<ReturnType<typeof listAdminReplies>>["rows"] }) {
  return (
    <table className="admin-table admin-table--wide">
      <thead>
        <tr>
          <th scope="col">回复内容</th>
          <th scope="col">所属帖子</th>
          <th scope="col">作者</th>
          <th scope="col">状态</th>
          <th scope="col">时间</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ reply, author, post }) => (
          <tr key={reply.id}>
            <td>
              <strong>{excerpt(reply.markdown)}</strong>
              {reply.hiddenReason && <small>隐藏原因：{reply.hiddenReason}</small>}
              <MarkdownDisclosure markdown={reply.markdown} />
            </td>
            <td>
              <Link className="admin-table-title-link" href={`/posts/${post.id}`}>
                {post.title}
              </Link>
            </td>
            <td>{author.displayName}</td>
            <td>
              <LifecyclePills record={reply} post={post} />
            </td>
            <td>{formatDateTime(reply.publishedAt)}</td>
            <td>
              <div className="admin-table-actions">
                <Link className="text-link" href={`/posts/${reply.postId}#reply-${reply.id}`}>
                  定位
                </Link>
                {reply.deletedAt && (
                  <ContentLifecycleControl
                    key={`reply-${reply.id}-restore-${reply.deletedAt.getTime()}`}
                    action={moderateReplyAction.bind(null, reply.id, "restore")}
                    operation="restore"
                    targetLabel="回复"
                  />
                )}
                {reply.hiddenAt ? (
                  <ContentLifecycleControl
                    key={`reply-${reply.id}-unhide-${reply.hiddenAt.getTime()}`}
                    action={moderateReplyAction.bind(null, reply.id, "unhide")}
                    operation="unhide"
                    targetLabel="回复"
                  />
                ) : (
                  <ContentLifecycleControl
                    key={`reply-${reply.id}-hide`}
                    action={moderateReplyAction.bind(null, reply.id, "hide")}
                    operation="hide"
                    targetLabel="回复"
                  />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function annotationAuthorLabel(author: AnnotationAuthorView) {
  return [author.displayName, annotationSourceMetadata(author)].filter(Boolean).join(" · ");
}

function AnnotationsTable({
  rows,
}: {
  rows: Awaited<ReturnType<typeof listAdminAnnotations>>["rows"];
}) {
  return (
    <table className="admin-table admin-table--wide">
      <thead>
        <tr>
          <th scope="col">批注</th>
          <th scope="col">所属帖子</th>
          <th scope="col">作者</th>
          <th scope="col">状态</th>
          <th scope="col">时间</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ annotation, author, post, isCurrent }) => (
          <tr key={annotation.id}>
            <td>
              <strong>{excerpt(annotation.contentMarkdown)}</strong>
              <small>原选文：{excerpt(annotation.originalSelectedText)}</small>
              {annotation.hiddenReason && <small>隐藏原因：{annotation.hiddenReason}</small>}
              <MarkdownDisclosure markdown={annotation.contentMarkdown} />
            </td>
            <td>
              <Link className="admin-table-title-link" href={`/posts/${post.id}`}>
                {post.title}
              </Link>
            </td>
            <td>{annotationAuthorLabel(author)}</td>
            <td>
              <LifecyclePills record={annotation} post={post} current={isCurrent} />
            </td>
            <td>{formatDateTime(annotation.sourceCreatedAt ?? annotation.createdAt)}</td>
            <td>
              <div className="admin-table-actions">
                <Link className="text-link" href={`/posts/${post.id}?annotation=${annotation.id}`}>
                  定位
                </Link>
                {annotation.hiddenAt ? (
                  <ContentLifecycleControl
                    key={`annotation-${annotation.id}-unhide-${annotation.hiddenAt.getTime()}`}
                    action={moderateAnnotationAction.bind(null, annotation.id, "unhide")}
                    operation="unhide"
                    targetLabel="批注"
                  />
                ) : (
                  <ContentLifecycleControl
                    key={`annotation-${annotation.id}-hide`}
                    action={moderateAnnotationAction.bind(null, annotation.id, "hide")}
                    operation="hide"
                    targetLabel="批注"
                  />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AnnotationRepliesTable({
  rows,
}: {
  rows: Awaited<ReturnType<typeof listAdminAnnotationReplies>>["rows"];
}) {
  return (
    <table className="admin-table admin-table--wide">
      <thead>
        <tr>
          <th scope="col">批注回复</th>
          <th scope="col">所属帖子</th>
          <th scope="col">作者</th>
          <th scope="col">状态</th>
          <th scope="col">时间</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ reply, author, annotation, post, isCurrent }) => (
          <tr key={reply.id}>
            <td>
              <strong>{excerpt(reply.contentMarkdown)}</strong>
              <small>回复批注：{excerpt(annotation.originalSelectedText)}</small>
              {reply.hiddenReason && <small>隐藏原因：{reply.hiddenReason}</small>}
              <MarkdownDisclosure markdown={reply.contentMarkdown} />
            </td>
            <td>
              <Link className="admin-table-title-link" href={`/posts/${post.id}`}>
                {post.title}
              </Link>
            </td>
            <td>{annotationAuthorLabel(author)}</td>
            <td>
              <LifecyclePills record={reply} post={post} current={isCurrent} />
            </td>
            <td>{formatDateTime(reply.sourceCreatedAt ?? reply.createdAt)}</td>
            <td>
              <div className="admin-table-actions">
                <Link className="text-link" href={`/posts/${post.id}?annotation=${annotation.id}`}>
                  定位
                </Link>
                {reply.hiddenAt ? (
                  <ContentLifecycleControl
                    key={`annotation-reply-${reply.id}-unhide-${reply.hiddenAt.getTime()}`}
                    action={moderateAnnotationReplyAction.bind(null, reply.id, "unhide")}
                    operation="unhide"
                    targetLabel="批注回复"
                  />
                ) : (
                  <ContentLifecycleControl
                    key={`annotation-reply-${reply.id}-hide`}
                    action={moderateAnnotationReplyAction.bind(null, reply.id, "hide")}
                    operation="hide"
                    targetLabel="批注回复"
                  />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function AdminMembers() {
  const [allowed, users] = await Promise.all([listAllowedUsers(), listUsers()]);
  const allowedByEmail = new Map(allowed.map((entry) => [entry.email, entry]));
  const userByEmail = new Map(users.map((user) => [user.emailKey, user]));
  const formerMembers = users.filter((user) => !allowedByEmail.has(user.emailKey));
  return (
    <section className="admin-section admin-members-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">访问资格</span>
          <h2>成员与白名单</h2>
        </div>
        <span>{allowed.length} 个受邀邮箱</span>
      </div>
      <div className="admin-members-invite">
        <p>添加邮箱后，对方可登录社区并创建个人资料。</p>
        <AddAllowlistForm action={addAllowlistAction} />
      </div>
      <div className="admin-table-scroll">
        <table className="admin-table admin-members-table">
          <thead>
            <tr>
              <th scope="col">邮箱</th>
              <th scope="col">社区资料</th>
              <th scope="col">资格</th>
              <th scope="col">加入时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {allowed.map((entry) => {
              const user = userByEmail.get(entry.email);
              return (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.email}</strong>
                  </td>
                  <td>{user ? user.displayName : <span className="admin-muted">尚未注册</span>}</td>
                  <td>
                    {entry.isAdmin ? (
                      <span className="status-pill status-pill--current">唯一管理员</span>
                    ) : (
                      <span className="status-pill status-pill--normal">已受邀</span>
                    )}
                  </td>
                  <td>
                    {user
                      ? formatDateTime(user.joinedAt)
                      : `邀请于 ${formatDateTime(entry.addedAt)}`}
                  </td>
                  <td>
                    {entry.isAdmin ? (
                      <small>唯一管理员不可移除</small>
                    ) : (
                      <RemoveAllowlistForm
                        action={removeAllowlistAction}
                        id={entry.id}
                        email={entry.email}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {formerMembers.map((user) => (
              <tr key={`former-${user.id}`}>
                <td>
                  <span className="admin-muted">{user.emailKey}</span>
                </td>
                <td>
                  <strong>{user.displayName}</strong>
                </td>
                <td>
                  <span className="status-pill status-pill--deleted">已移出白名单</span>
                </td>
                <td>{formatDateTime(user.joinedAt)}</td>
                <td>
                  <small>历史内容保留</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function AdminAudit({ view }: { view: AdminView }) {
  const result = await listAdminAuditLogPage(view.page);
  return (
    <section className="admin-section admin-audit-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">可追溯记录</span>
          <h2>管理员操作记录</h2>
        </div>
        <span>{result.total} 条</span>
      </div>
      {result.rows.length ? (
        <div className="admin-audit-list">
          {result.rows.map(({ audit, administrator }) => (
            <article key={audit.id}>
              <span
                className={`admin-audit-dot admin-audit-dot--${audit.actionType.endsWith("_HIDDEN") ? "danger" : "normal"}`}
                aria-hidden="true"
              />
              <div>
                <strong>{auditLabels[audit.actionType] ?? audit.actionType}</strong>
                <p>
                  {administrator.displayName} · {formatDateTime(audit.createdAt)}
                </p>
                <code>
                  {audit.targetType} · {audit.targetId}
                </code>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-copy">还没有管理员操作记录。</p>
      )}
      <Pagination view={view} total={result.total} page={result.page} pageSize={result.pageSize} />
    </section>
  );
}

function AdminAside() {
  return (
    <aside className="admin-aside" aria-label="管理摘要">
      <RegionErrorBoundary
        title="邀请信息暂时无法载入"
        description="稍后可在成员与白名单页面重试。"
      >
        <Suspense fallback={<AdminAsideSkeleton title="邀请新成员" />}>
          <InvitePanel />
        </Suspense>
      </RegionErrorBoundary>
      <RegionErrorBoundary title="操作记录暂时无法载入" description="稍后可在操作日志页面重试。">
        <Suspense fallback={<AdminAsideSkeleton title="最近操作记录" />}>
          <RecentAuditPanel />
        </Suspense>
      </RegionErrorBoundary>
      <RegionErrorBoundary title="成员信息暂时无法载入" description="稍后可在成员页面重试。">
        <Suspense fallback={<AdminAsideSkeleton title="最近注册成员" />}>
          <RecentMembersPanel />
        </Suspense>
      </RegionErrorBoundary>
    </aside>
  );
}

function AdminAsideSkeleton({ title }: { title: string }) {
  return (
    <section className="admin-aside-panel" aria-busy="true">
      <h2>{title}</h2>
      <div className="skeleton-lines" aria-hidden="true">
        <span className="skeleton-block" />
        <span className="skeleton-block" />
        <span className="skeleton-block" />
      </div>
    </section>
  );
}

async function InvitePanel() {
  const allowed = await listAllowedUsers();
  return (
    <section className="admin-aside-panel">
      <div className="admin-aside-heading">
        <h2>邀请新成员</h2>
        <Link href="/admin?section=members">查看全部</Link>
      </div>
      <AddAllowlistForm action={addAllowlistAction} />
      <div className="admin-aside-list">
        <span>当前白名单（{allowed.length}）</span>
        {allowed.slice(0, 3).map((entry) => (
          <p key={entry.id}>
            <strong>{entry.email}</strong>
            <small>{entry.isAdmin ? "唯一管理员" : "已受邀"}</small>
          </p>
        ))}
      </div>
    </section>
  );
}

async function RecentAuditPanel() {
  const audit = await listAdminAuditLog(5);
  return (
    <section className="admin-aside-panel">
      <div className="admin-aside-heading">
        <h2>最近操作记录</h2>
        <Link href="/admin?section=audit">更多</Link>
      </div>
      <div className="admin-aside-audit">
        {audit.length ? (
          audit.map(({ audit: entry, administrator }) => (
            <article key={entry.id}>
              <span className="admin-audit-dot" aria-hidden="true" />
              <p>
                <strong>{auditLabels[entry.actionType] ?? entry.actionType}</strong>
                <small>
                  {administrator.displayName} · {formatDateTime(entry.createdAt)}
                </small>
              </p>
            </article>
          ))
        ) : (
          <p className="empty-copy">还没有操作记录。</p>
        )}
      </div>
    </section>
  );
}

async function RecentMembersPanel() {
  const users = await listRecentUsers(5);
  return (
    <section className="admin-aside-panel">
      <div className="admin-aside-heading">
        <h2>最近注册成员</h2>
        <Link href="/admin?section=members">更多</Link>
      </div>
      <div className="admin-aside-members">
        {users.length ? (
          users.map((user) => (
            <p key={user.id}>
              <span aria-hidden="true">{user.displayName.slice(0, 1)}</span>
              <strong>{user.displayName}</strong>
              <small>{formatDateTime(user.joinedAt)}</small>
            </p>
          ))
        ) : (
          <p className="empty-copy">还没有注册成员。</p>
        )}
      </div>
    </section>
  );
}
