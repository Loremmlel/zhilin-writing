import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RestoreRevisionForm } from "@/components/admin/restore-revision-form";
import { AdminShell } from "@/components/admin/admin-shell";
import { RevisionPreviewSkeleton } from "@/components/loading/skeletons";
import { RegionErrorBoundary } from "@/components/region-error-boundary";
import { getPostForAdministration } from "@/db/queries";
import { requireAdministrator } from "@/lib/auth/access";
import { formatDateTime } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown/render";
import { getRevisionSnapshot, listPostRevisions } from "@/lib/revisions/service";
import { restoreRevisionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "帖子历史 | 知临中学" };

const revisionKindLabels = {
  CONTENT_EDIT: "内容编辑",
  RESTORE: "版本恢复",
  ANNOTATION_STATE: "批注状态变化",
} as const;

export default async function PostRevisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<{ revision?: string; restored?: string }>;
}) {
  const { postId } = await params;
  const query = await searchParams;
  await requireAdministrator(`/admin/revisions/${postId}`);
  const [post, revisions] = await Promise.all([
    getPostForAdministration(postId),
    listPostRevisions(postId),
  ]);
  if (!post) notFound();
  const selectedId = query.revision ?? post.post.currentRevisionId ?? revisions[0]?.revision.id;
  const revisionNumbers = new Map(
    revisions.map((item) => [item.revision.id, item.revision.revisionNumber]),
  );
  if (!selectedId) notFound();

  return (
    <AdminShell active="posts">
      <div className="admin-page revision-admin-page">
        <header className="page-header">
          <span className="eyebrow">管理员 · Post revisions</span>
          <h1>{post.post.title}</h1>
          <p>历史内容只对唯一管理员开放。预览与恢复不会创建公开动态或通知。</p>
        </header>
        {query.restored === "1" && (
          <p className="content-notice" role="status">
            历史版本已复制为新的当前版本。
          </p>
        )}
        <div className="revision-admin-layout">
          <aside className="revision-timeline" aria-label="Post revisions">
            <div className="section-heading">
              <h2>Post revisions</h2>
              <span>{revisions.length} 个</span>
            </div>
            <div className="revision-list">
              {revisions.map(({ revision, creator }) => {
                const isCurrent = revision.id === post.post.currentRevisionId;
                const restoreNumber = revision.restoreSourceRevisionId
                  ? revisionNumbers.get(revision.restoreSourceRevisionId)
                  : null;
                return (
                  <Link
                    key={revision.id}
                    href={`/admin/revisions/${postId}?revision=${encodeURIComponent(revision.id)}`}
                    className={`revision-list-item${revision.id === selectedId ? " is-selected" : ""}`}
                  >
                    <span className="revision-number">v{revision.revisionNumber}</span>
                    <strong>{revision.title}</strong>
                    <small>
                      {formatDateTime(revision.createdAt)} · {creator.displayName}
                    </small>
                    <span className="revision-badges">
                      <em>{revisionKindLabels[revision.kind]}</em>
                      {isCurrent && <em>当前版本</em>}
                      {restoreNumber && <em>恢复自 v{restoreNumber}</em>}
                    </span>
                  </Link>
                );
              })}
            </div>
          </aside>
          <RegionErrorBoundary
            title="版本预览暂时无法载入"
            description="当前选中的版本仍会保留，请稍后重试。"
          >
            <Suspense fallback={<RevisionPreviewSkeleton />}>
              <RevisionPreview
                postId={postId}
                selectedId={selectedId}
                currentRevisionId={post.post.currentRevisionId}
                postDeleted={Boolean(post.post.deletedAt)}
              />
            </Suspense>
          </RegionErrorBoundary>
        </div>
      </div>
    </AdminShell>
  );
}

async function RevisionPreview({
  postId,
  selectedId,
  currentRevisionId,
  postDeleted,
}: {
  postId: string;
  selectedId: string;
  currentRevisionId: string | null;
  postDeleted: boolean;
}) {
  const selected = await getRevisionSnapshot(postId, selectedId);
  if (!selected) notFound();
  const attachmentIds = new Set(
    selected.assetRefs.filter((ref) => ref.usage === "attachment").map((ref) => ref.assetId),
  );
  const selectedAttachments = selected.assets.filter((asset) => attachmentIds.has(asset.id));
  const selectedIsCurrent = selected.revision.id === currentRevisionId;
  const currentSnapshot =
    selectedIsCurrent || !currentRevisionId
      ? selected
      : await getRevisionSnapshot(postId, currentRevisionId);
  const selectedAnnotationIds = new Set(
    selected.annotationStates.map((state) => state.annotationId),
  );
  const exitingAnnotationCount =
    currentSnapshot?.annotationStates.filter(
      (state) => !selectedAnnotationIds.has(state.annotationId),
    ).length ?? 0;

  return (
    <main className="revision-preview">
      <div className="revision-preview-header">
        <div>
          <span className="version-label">历史版本预览 · v{selected.revision.revisionNumber}</span>
          <h2>{selected.revision.title}</h2>
        </div>
        {!selectedIsCurrent && (
          <RestoreRevisionForm
            revisionNumber={selected.revision.revisionNumber}
            restoresDeletedPost={postDeleted}
            annotationCount={selected.annotationStates.length}
            exitingAnnotationCount={exitingAnnotationCount}
            action={restoreRevisionAction.bind(null, postId, selected.revision.id)}
          />
        )}
        {selectedIsCurrent && <span className="current-revision-pill">当前版本</span>}
      </div>
      <article
        className="markdown-body revision-markdown"
        dangerouslySetInnerHTML={{
          __html: await renderMarkdown(selected.revision.markdown, {
            annotationIds: selected.annotationStates.map((state) => state.annotationId),
            interactiveAnnotations: false,
          }),
        }}
      />
      <section className="revision-assets">
        <div className="section-heading">
          <h3>批注快照</h3>
          <span>{selected.annotationStates.length} 条</span>
        </div>
        <p className="muted">
          该版本记录了当时属于正文的批注锚点，以及每条批注当时的删除或隐藏状态。
        </p>
        {!selectedIsCurrent && exitingAnnotationCount > 0 && (
          <p className="content-notice" role="status">
            恢复此版本将使当前版本中的 {exitingAnnotationCount} 条批注不再属于当前正文。
          </p>
        )}
      </section>
      <section className="revision-assets">
        <div className="section-heading">
          <h3>附件快照</h3>
          <span>{selectedAttachments.length} 个</span>
        </div>
        {selectedAttachments.length === 0 ? (
          <p className="muted">这个版本没有帖子附件。</p>
        ) : (
          selectedAttachments.map((asset) => (
            <a className="attachment-link" href={`/api/assets/${asset.id}`} key={asset.id}>
              <span>{asset.filename}</span>
              <small>{Math.ceil(asset.byteSize / 1024)} KB</small>
            </a>
          ))
        )}
      </section>
    </main>
  );
}
