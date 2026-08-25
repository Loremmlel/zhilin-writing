import Link from "next/link";
import { notFound } from "next/navigation";

import { RestoreRevisionForm } from "@/components/admin/restore-revision-form";
import { getPost } from "@/db/queries";
import { requireAdministrator } from "@/lib/auth/access";
import { formatDateTime } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown/render";
import { getRevisionSnapshot, listPostRevisions } from "@/lib/revisions/service";
import { restoreRevisionAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PostRevisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<{ revision?: string; restored?: string }>;
}) {
  const { postId } = await params;
  const query = await searchParams;
  const [, post, revisions] = await Promise.all([
    requireAdministrator(`/admin/revisions/${postId}`),
    getPost(postId),
    listPostRevisions(postId),
  ]);
  if (!post) notFound();
  const selectedId = query.revision ?? post.post.currentRevisionId ?? revisions[0]?.revision.id;
  const selected = selectedId ? await getRevisionSnapshot(postId, selectedId) : null;
  if (!selected) notFound();
  const revisionNumbers = new Map(revisions.map((item) => [item.revision.id, item.revision.revisionNumber]));
  const attachmentIds = new Set(selected.assetRefs.filter((ref) => ref.usage === "attachment").map((ref) => ref.assetId));
  const selectedAttachments = selected.assets.filter((asset) => attachmentIds.has(asset.id));
  const selectedIsCurrent = selected.revision.id === post.post.currentRevisionId;

  return (
    <div className="page-column revision-admin-page">
      <header className="page-header">
        <span className="eyebrow">管理员 · Post revisions</span>
        <h1>{post.post.title}</h1>
        <p>历史内容只对唯一管理员开放。预览与恢复不会创建公开动态或通知。</p>
      </header>
      {query.restored === "1" && <p className="content-notice" role="status">历史版本已复制为新的当前版本。</p>}
      <div className="revision-admin-layout">
        <aside className="revision-timeline" aria-label="Post revisions">
          <div className="section-heading"><h2>Post revisions</h2><span>{revisions.length} 个</span></div>
          <div className="revision-list">
            {revisions.map(({ revision, creator }) => {
              const isCurrent = revision.id === post.post.currentRevisionId;
              const restoreNumber = revision.restoreSourceRevisionId ? revisionNumbers.get(revision.restoreSourceRevisionId) : null;
              return <Link
                key={revision.id}
                href={`/admin/revisions/${postId}?revision=${encodeURIComponent(revision.id)}`}
                className={`revision-list-item${revision.id === selected.revision.id ? " is-selected" : ""}`}
              >
                <span className="revision-number">v{revision.revisionNumber}</span>
                <strong>{revision.title}</strong>
                <small>{formatDateTime(revision.createdAt)} · {creator.displayName}</small>
                <span className="revision-badges">
                  {isCurrent && <em>当前版本</em>}
                  {restoreNumber && <em>恢复自 v{restoreNumber}</em>}
                </span>
              </Link>;
            })}
          </div>
        </aside>
        <main className="revision-preview">
          <div className="revision-preview-header">
            <div><span className="version-label">历史版本预览 · v{selected.revision.revisionNumber}</span><h2>{selected.revision.title}</h2></div>
            {!selectedIsCurrent && <RestoreRevisionForm
              revisionNumber={selected.revision.revisionNumber}
              action={restoreRevisionAction.bind(null, postId, selected.revision.id)}
            />}
            {selectedIsCurrent && <span className="current-revision-pill">当前版本</span>}
          </div>
          <article className="markdown-body revision-markdown" dangerouslySetInnerHTML={{ __html: await renderMarkdown(selected.revision.markdown) }} />
          <section className="revision-assets">
            <div className="section-heading"><h3>附件快照</h3><span>{selectedAttachments.length} 个</span></div>
            {selectedAttachments.length === 0
              ? <p className="muted">这个版本没有帖子附件。</p>
              : selectedAttachments.map((asset) => <a className="attachment-link" href={`/api/assets/${asset.id}`} key={asset.id}><span>{asset.filename}</span><small>{Math.ceil(asset.byteSize / 1024)} KB</small></a>)}
          </section>
        </main>
      </div>
    </div>
  );
}
