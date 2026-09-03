import Link from "next/link";
import { Suspense } from "react";

import { ContentLifecycleControl } from "@/components/admin/content-lifecycle-control";
import { AddAllowlistForm, RemoveAllowlistForm } from "@/components/admin/allowlist-forms";
import { AdminListSkeleton } from "@/components/loading/skeletons";
import { RegionErrorBoundary } from "@/components/region-error-boundary";
import {
  listAdminAuditLog,
  listAdminPosts,
  listAdminReplies,
  listAllowedUsers,
  listUsers,
  type AdminContentStatus,
} from "@/db/queries";
import { listAdminAnnotationReplies, listAdminAnnotations } from "@/lib/annotations/queries";
import { annotationSourceMetadata, type AnnotationAuthorView } from "@/lib/annotations/identity";
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

function adminEmptyCopy(contentType: AdminContentType, status: AdminContentStatus): string {
  const noun = contentTypeLabels[contentType];
  if (status === "deleted") return `没有被作者删除的${noun}。`;
  if (status === "hidden") return `没有被管理员隐藏的${noun}。`;
  return `没有处于正常状态的${noun}。`;
}

function annotationAuthorLabel(author: AnnotationAuthorView): string {
  return [author.displayName, annotationSourceMetadata(author)].filter(Boolean).join(" · ");
}

function ParentPostLifecycle({
  post,
}: {
  post: { deletedAt: Date | null; hiddenAt: Date | null };
}) {
  return (
    <>
      {post.deletedAt && (
        <span className="status-pill status-pill--deleted">所属帖子：用户已删除</span>
      )}
      {post.hiddenAt && (
        <span className="status-pill status-pill--hidden">所属帖子：管理员已隐藏</span>
      )}
    </>
  );
}

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

type AdminContentType = "posts" | "replies" | "annotations" | "annotation-replies";
type AdminQuery = { error?: string; type?: string; status?: string };

export default async function AdminPage({ searchParams }: { searchParams: Promise<AdminQuery> }) {
  const [, query] = await Promise.all([requireAdministrator("/admin"), searchParams]);
  return (
    <div className="page-column admin-page">
      <header className="page-header">
        <span className="eyebrow">管理员</span>
        <h1>管理后台</h1>
        <p>
          检查内容状态、恢复误删内容，并管理受邀成员。所有原文查看与状态操作都经过服务端管理员校验。
        </p>
      </header>
      <RegionErrorBoundary
        title="管理列表暂时无法载入"
        description="当前内容类型和状态筛选仍会保留，请稍后重试。"
      >
        <Suspense fallback={<AdminListSkeleton />}>
          <AdminContent query={query} />
        </Suspense>
      </RegionErrorBoundary>
    </div>
  );
}

async function AdminContent({ query }: { query: AdminQuery }) {
  const contentType: AdminContentType =
    query.type === "replies" || query.type === "annotations" || query.type === "annotation-replies"
      ? query.type
      : "posts";
  const status: AdminContentStatus =
    query.status === "deleted" || query.status === "hidden" ? query.status : "normal";
  const [allowed, users, content, audit] = await Promise.all([
    listAllowedUsers(),
    listUsers(),
    contentType === "posts"
      ? listAdminPosts(status)
      : contentType === "replies"
        ? listAdminReplies(status)
        : contentType === "annotations"
          ? listAdminAnnotations(status)
          : listAdminAnnotationReplies(status),
    listAdminAuditLog(),
  ]);
  const contentHref = (nextType: AdminContentType, nextStatus: AdminContentStatus) =>
    `/admin?type=${nextType}&status=${nextStatus}`;

  return (
    <>
      <section className="admin-section">
        <div className="section-heading">
          <h2>内容管理</h2>
          <span>{content.length} 条</span>
        </div>
        <nav className="list-tabs" aria-label="内容类型">
          <Link
            href={contentHref("posts", status)}
            className={contentType === "posts" ? "is-active" : ""}
          >
            Posts
          </Link>
          <Link
            href={contentHref("replies", status)}
            className={contentType === "replies" ? "is-active" : ""}
          >
            Replies
          </Link>
          <Link
            href={contentHref("annotations", status)}
            className={contentType === "annotations" ? "is-active" : ""}
          >
            Annotations
          </Link>
          <Link
            href={contentHref("annotation-replies", status)}
            className={contentType === "annotation-replies" ? "is-active" : ""}
          >
            Annotation replies
          </Link>
        </nav>
        <nav className="list-tabs list-tabs--secondary" aria-label="内容状态">
          {(Object.keys(statusLabels) as AdminContentStatus[]).map((value) => (
            <Link
              key={value}
              href={contentHref(contentType, value)}
              className={status === value ? "is-active" : ""}
            >
              {statusLabels[value]}
            </Link>
          ))}
        </nav>

        <div className="admin-list admin-content-list">
          {contentType === "posts" &&
            (content as Awaited<ReturnType<typeof listAdminPosts>>).map(({ post, author }) => (
              <article className="admin-row admin-content-row" key={post.id}>
                <div className="admin-content-main">
                  <div className="status-line">
                    {!post.deletedAt && !post.hiddenAt && (
                      <span className="status-pill status-pill--normal">正常</span>
                    )}
                    {post.deletedAt && (
                      <span className="status-pill status-pill--deleted">用户已删除</span>
                    )}
                    {post.hiddenAt && (
                      <span className="status-pill status-pill--hidden">管理员已隐藏</span>
                    )}
                  </div>
                  <strong>{post.title}</strong>
                  <span>
                    {author.displayName} · {formatDateTime(post.publishedAt)}
                  </span>
                  {post.hiddenReason && <span>隐藏原因：{post.hiddenReason}</span>}
                </div>
                <div className="admin-row-actions">
                  <Link className="text-link" href={`/posts/${post.id}`}>
                    对应帖子
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
              </article>
            ))}

          {contentType === "replies" &&
            (content as Awaited<ReturnType<typeof listAdminReplies>>).map(
              ({ reply, author, post }) => (
                <article className="admin-row admin-content-row" key={reply.id}>
                  <div className="admin-content-main">
                    <div className="status-line">
                      {!reply.deletedAt && !reply.hiddenAt && (
                        <span className="status-pill status-pill--normal">正常</span>
                      )}
                      {reply.deletedAt && (
                        <span className="status-pill status-pill--deleted">用户已删除</span>
                      )}
                      {reply.hiddenAt && (
                        <span className="status-pill status-pill--hidden">管理员已隐藏</span>
                      )}
                      <ParentPostLifecycle post={post} />
                    </div>
                    <strong>
                      {author.displayName} 回复《{post.title}》
                    </strong>
                    <span>{formatDateTime(reply.publishedAt)}</span>
                    {reply.hiddenReason && <span>隐藏原因：{reply.hiddenReason}</span>}
                    <details className="admin-content-preview">
                      <summary>查看原始 Markdown</summary>
                      <pre>{reply.markdown}</pre>
                    </details>
                  </div>
                  <div className="admin-row-actions">
                    <Link className="text-link" href={`/posts/${reply.postId}#reply-${reply.id}`}>
                      对应帖子
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
                </article>
              ),
            )}

          {contentType === "annotations" &&
            (content as Awaited<ReturnType<typeof listAdminAnnotations>>).map(
              ({ annotation, author, post }) => (
                <article className="admin-row admin-content-row" key={annotation.id}>
                  <div className="admin-content-main">
                    <div className="status-line">
                      {!annotation.deletedAt && !annotation.hiddenAt && (
                        <span className="status-pill status-pill--normal">正常</span>
                      )}
                      {annotation.deletedAt && (
                        <span className="status-pill status-pill--deleted">用户已删除</span>
                      )}
                      {annotation.hiddenAt && (
                        <span className="status-pill status-pill--hidden">管理员已隐藏</span>
                      )}
                      <ParentPostLifecycle post={post} />
                    </div>
                    <strong>
                      {annotationAuthorLabel(author)} 批注《{post.title}》
                    </strong>
                    <span>
                      {formatDateTime(annotation.sourceCreatedAt ?? annotation.createdAt)} ·
                      原选文：{annotation.originalSelectedText}
                    </span>
                    {annotation.hiddenReason && <span>隐藏原因：{annotation.hiddenReason}</span>}
                    <details className="admin-content-preview">
                      <summary>查看原始 Markdown</summary>
                      <pre>{annotation.contentMarkdown}</pre>
                    </details>
                  </div>
                  <div className="admin-row-actions">
                    <Link
                      className="text-link"
                      href={`/posts/${post.id}?annotation=${annotation.id}`}
                    >
                      对应帖子
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
                </article>
              ),
            )}

          {contentType === "annotation-replies" &&
            (content as Awaited<ReturnType<typeof listAdminAnnotationReplies>>).map(
              ({ reply, author, annotation, post }) => (
                <article className="admin-row admin-content-row" key={reply.id}>
                  <div className="admin-content-main">
                    <div className="status-line">
                      {!reply.deletedAt && !reply.hiddenAt && (
                        <span className="status-pill status-pill--normal">正常</span>
                      )}
                      {reply.deletedAt && (
                        <span className="status-pill status-pill--deleted">用户已删除</span>
                      )}
                      {reply.hiddenAt && (
                        <span className="status-pill status-pill--hidden">管理员已隐藏</span>
                      )}
                      <ParentPostLifecycle post={post} />
                    </div>
                    <strong>
                      {annotationAuthorLabel(author)} 回复《{post.title}》中的批注
                    </strong>
                    <span>
                      {formatDateTime(reply.sourceCreatedAt ?? reply.createdAt)} · 批注{" "}
                      {annotation.id}
                    </span>
                    {reply.hiddenReason && <span>隐藏原因：{reply.hiddenReason}</span>}
                    <details className="admin-content-preview">
                      <summary>查看原始 Markdown</summary>
                      <pre>{reply.contentMarkdown}</pre>
                    </details>
                  </div>
                  <div className="admin-row-actions">
                    <Link
                      className="text-link"
                      href={`/posts/${post.id}?annotation=${annotation.id}`}
                    >
                      对应帖子
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
                </article>
              ),
            )}
          {content.length === 0 && (
            <p className="empty-copy">{adminEmptyCopy(contentType, status)}</p>
          )}
        </div>
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <h2>管理员操作记录</h2>
          <span>{audit.length} 条</span>
        </div>
        <div className="admin-list">
          {audit.map(({ audit: entry, administrator }) => (
            <div className="admin-row" key={entry.id}>
              <div>
                <strong>{auditLabels[entry.actionType] ?? entry.actionType}</strong>
                <span>
                  {administrator.displayName} · {entry.targetType} ·{" "}
                  {formatDateTime(entry.createdAt)}
                </span>
              </div>
              <code>{entry.targetId}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <h2>邀请邮箱</h2>
          <span>{allowed.length} 个</span>
        </div>
        <AddAllowlistForm action={addAllowlistAction} />
        {query.error && <p className="form-error">{query.error}</p>}
        <div className="admin-list">
          {allowed.map((entry) => (
            <div className="admin-row" key={entry.id}>
              <div>
                <strong>{entry.email}</strong>
                <span>
                  {entry.isAdmin ? "唯一管理员" : `添加于 ${formatDateTime(entry.addedAt)}`}
                </span>
              </div>
              {!entry.isAdmin && (
                <RemoveAllowlistForm action={removeAllowlistAction} id={entry.id} />
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="admin-section">
        <div className="section-heading">
          <h2>已注册成员</h2>
          <span>{users.length} 位</span>
        </div>
        <div className="admin-list">
          {users.map((user) => (
            <div className="admin-row" key={user.id}>
              <div>
                <strong>{user.displayName}</strong>
                <span>{formatDateTime(user.joinedAt)} 加入</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
