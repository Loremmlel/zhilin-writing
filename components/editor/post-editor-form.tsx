"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ModalDialog } from "@/components/modal-dialog";
import { loadDraft, removeDraft, saveDraft, type LocalDraft } from "@/lib/drafts/indexed-db";
import { chooseConflictResolution, hasRecoverablePublishedDraft } from "@/lib/editor/conflict";
import type { EditConflictSnapshot } from "@/lib/revisions/service";
import { MarkdownEditor, type UploadedAsset } from "./markdown-editor";

export type PostActionState = {
  error?: string;
  postId?: string;
  currentRevisionId?: string;
  conflict?: EditConflictSnapshot;
};
export type PostFormAction = (state: PostActionState, formData: FormData) => Promise<PostActionState>;

type InitialEditorState = {
  title: string;
  markdown: string;
  tags: string[];
  baseRevisionId: string | null;
  attachments: UploadedAsset[];
};

type PostEditorFormProps = {
  userId: string;
  draftId: string;
  action: PostFormAction;
  initial?: InitialEditorState;
  submitLabel?: string;
  cancelHref?: string;
};

function normalizedDraft(draft: LocalDraft): LocalDraft {
  const legacy = draft as LocalDraft & { assetIds?: string[]; baseRevisionId?: string | null };
  return {
    ...draft,
    attachmentIds: Array.isArray(legacy.attachmentIds) ? legacy.attachmentIds : (legacy.assetIds ?? []),
    baseRevisionId: legacy.baseRevisionId ?? null,
  };
}

export function PostEditorForm({ userId, draftId, action, initial, submitLabel = "发布帖子", cancelHref = "/" }: PostEditorFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [markdown, setMarkdown] = useState(initial?.markdown ?? "");
  const [tags, setTags] = useState(initial?.tags.join("，") ?? "");
  const [attachments, setAttachments] = useState<UploadedAsset[]>(initial?.attachments ?? []);
  const [attachmentIds, setAttachmentIds] = useState(initial?.attachments.map((asset) => asset.id) ?? []);
  const [baseRevisionId, setBaseRevisionId] = useState(initial?.baseRevisionId ?? null);
  const [overwriteBaseRevisionId, setOverwriteBaseRevisionId] = useState<string | null>(null);
  const [editorResetRevision, setEditorResetRevision] = useState(0);
  const [draftStatus, setDraftStatus] = useState<"loading" | "saving" | "saved" | "failed">("loading");
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [recoverableDraft, setRecoverableDraft] = useState<LocalDraft | null>(null);
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);
  const [conflict, setConflict] = useState<EditConflictSnapshot | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [confirmChoice, setConfirmChoice] = useState<"online" | "overwrite" | null>(null);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async (previous: PostActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.conflict) {
      setConflict(result.conflict);
      setConflictOpen(true);
      setConfirmChoice(null);
      setSaveBlocked(true);
    }
    return result;
  }, {});
  const editorKey = `${draftId}:${hydrated ? "ready" : "initial"}`;

  useEffect(() => {
    let live = true;
    void loadDraft(userId, draftId).then((value) => {
      if (!live) return;
      if (value) {
        const draft = normalizedDraft(value);
        if (initial?.baseRevisionId) {
          const serverDraft: LocalDraft = {
            title: initial.title,
            markdown: initial.markdown,
            tags: initial.tags.join("，"),
            attachmentIds: initial.attachments.map((asset) => asset.id),
            baseRevisionId: initial.baseRevisionId,
            updatedAt: 0,
          };
          if (hasRecoverablePublishedDraft(draft, serverDraft)) setRecoverableDraft(draft);
        } else {
          applyDraft(draft);
        }
      }
      setHydrated(true);
      setDraftStatus("saved");
    }).catch(() => {
      if (live) {
        setHydrated(true);
        setDraftStatus("failed");
      }
    });
    return () => { live = false; };
    // Initial server content is intentionally captured once for this editor session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, userId]);

  useEffect(() => {
    if (!hydrated || !dirty || state.postId) return;
    const statusTimer = window.setTimeout(() => setDraftStatus("saving"), 0);
    const timer = window.setTimeout(() => {
      const draft: LocalDraft = { title, markdown, tags, attachmentIds, attachments, baseRevisionId, updatedAt: Date.now() };
      void saveDraft(userId, draftId, draft)
        .then(() => setDraftStatus("saved"))
        .catch(() => setDraftStatus("failed"));
    }, 700);
    return () => {
      window.clearTimeout(statusTimer);
      window.clearTimeout(timer);
    };
  }, [attachmentIds, attachments, baseRevisionId, dirty, draftId, hydrated, markdown, state.postId, tags, title, userId]);

  useEffect(() => {
    if (!state.postId) return;
    void removeDraft(userId, draftId).finally(() => router.push(`/posts/${state.postId}`));
  }, [draftId, router, state.postId, userId]);

  function applyDraft(draft: LocalDraft) {
    setTitle(draft.title);
    setMarkdown(draft.markdown);
    setTags(draft.tags);
    setAttachmentIds(draft.attachmentIds);
    if (draft.attachments) setAttachments(draft.attachments);
    setBaseRevisionId(draft.baseRevisionId ?? initial?.baseRevisionId ?? null);
    setEditorResetRevision((current) => current + 1);
    setDirty(true);
  }

  function localEditorState() {
    return { title, markdown, tags, attachmentIds, baseRevisionId };
  }

  async function uploadAttachment(file: File) {
    setUploadError(null);
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/assets", { method: "POST", body: formData });
    const data = await response.json() as { error?: string; asset?: UploadedAsset; markdown?: string };
    if (!response.ok || !data.asset) throw new Error(data.error ?? "上传失败");
    const asset = { ...data.asset, markdown: data.markdown ?? "" } as UploadedAsset;
    setAttachments((current) => [...current.filter((item) => item.id !== asset.id), asset]);
    setAttachmentIds((current) => [...new Set([...current, asset.id])]);
    setDirty(true);
  }

  function useOnlineVersion() {
    if (!conflict) return;
    const next = chooseConflictResolution("online", localEditorState(), {
      revisionId: conflict.revisionId,
      title: conflict.title,
      markdown: conflict.markdown,
      tags: conflict.tags.join("，"),
      attachmentIds: conflict.attachments.map((asset) => asset.id),
    });
    setTitle(next.title);
    setMarkdown(next.markdown);
    setTags(next.tags);
    setAttachmentIds(next.attachmentIds);
    setAttachments(conflict.attachments.map((asset) => ({
      ...asset,
      kind: "attachment" as const,
      url: `/api/assets/${asset.id}`,
      markdown: `[${asset.filename}](/api/assets/${asset.id})`,
    })));
    setBaseRevisionId(next.baseRevisionId);
    setOverwriteBaseRevisionId(null);
    setConflictOpen(false);
    setConfirmChoice(null);
    setSaveBlocked(false);
    setDirty(false);
    setEditorResetRevision((current) => current + 1);
    void removeDraft(userId, draftId);
  }

  function useMineAndOverwrite() {
    if (!conflict) return;
    const next = chooseConflictResolution("overwrite", localEditorState(), {
      revisionId: conflict.revisionId,
      title: conflict.title,
      markdown: conflict.markdown,
      tags: conflict.tags.join("，"),
      attachmentIds: conflict.attachments.map((asset) => asset.id),
    });
    setBaseRevisionId(next.baseRevisionId);
    setOverwriteBaseRevisionId(next.overwriteBaseRevisionId);
    setConflictOpen(false);
    setConfirmChoice(null);
    setSaveBlocked(false);
    window.setTimeout(() => formRef.current?.requestSubmit(), 0);
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="editor-form" noValidate>
        <input type="hidden" name="markdown" value={markdown} />
        <input type="hidden" name="attachmentIds" value={JSON.stringify(attachmentIds)} />
        <input type="hidden" name="baseRevisionId" value={baseRevisionId ?? ""} />
        <input type="hidden" name="overwriteBaseRevisionId" value={overwriteBaseRevisionId ?? ""} />
        <div className="editor-topline">
          <span className={`draft-status draft-status--${draftStatus}`} role="status">
            {draftStatus === "loading" && "检查本地修改…"}
            {draftStatus === "saving" && "保存中…"}
            {draftStatus === "saved" && "本地修改已保存"}
            {draftStatus === "failed" && "本地保存失败"}
          </span>
          <span>Markdown 将作为正文的唯一存储格式</span>
        </div>
        {recoverableDraft && <section className="draft-recovery" aria-labelledby="draft-recovery-title">
          <div><strong id="draft-recovery-title">检测到此前未提交的修改</strong><p>这些内容只保存在当前浏览器中，尚未写入线上帖子。</p></div>
          <div className="draft-recovery-actions">
            <button type="button" className="button button--primary button--small" onClick={() => {
              applyDraft(recoverableDraft);
              setRecoverableDraft(null);
            }}>继续编辑</button>
            <button type="button" className="button button--ghost button--small" onClick={() => setDiscardDraftOpen(true)}>放弃本地修改</button>
          </div>
        </section>}
        {saveBlocked && conflict && <section className="conflict-warning" role="status">
          <div><strong>线上版本已经变化</strong><p>你的内容仍保存在本地。重新处理冲突后才能保存。</p></div>
          <button type="button" className="button button--ghost button--small" onClick={() => setConflictOpen(true)}>处理冲突</button>
        </section>}
        <label className="field-label" htmlFor="post-title">标题</label>
        <input id="post-title" className="title-input" name="title" value={title} onChange={(event) => {
          setTitle(event.target.value);
          setDirty(true);
        }} maxLength={120} placeholder="给这篇文字起一个标题" aria-invalid={Boolean(state.error && !conflict)} />
        <label className="field-label">正文</label>
        <MarkdownEditor key={editorKey} initialMarkdown={markdown} resetRevision={editorResetRevision} onMarkdownChange={(value) => {
          setMarkdown(value);
          setDirty(true);
        }} />
        <div className="editor-subgrid">
          <label>
            <span className="field-label">标签（最多 5 个，用逗号分隔）</span>
            <input className="text-input" name="tags" value={tags} onChange={(event) => {
              setTags(event.target.value);
              setDirty(true);
            }} placeholder="随笔，生活" />
          </label>
          <label className="attachment-upload">
            <span className="field-label">附件</span>
            <input type="file" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAttachment(file).catch((error) => setUploadError(error instanceof Error ? error.message : "上传失败"));
              event.currentTarget.value = "";
            }} />
            <span className="muted">上传到文件区；可插入正文链接。</span>
          </label>
        </div>
        {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
        {attachments.length > 0 && <div className="asset-list" aria-label="帖子附件">
          {attachments.filter((asset) => attachmentIds.includes(asset.id)).map((asset) => <div key={asset.id} className="asset-row">
            <span>{asset.filename}</span>
            <span className="asset-row-actions">
              <button type="button" className="text-button" onClick={() => {
                setMarkdown((current) => `${current.trimEnd()}\n\n${asset.markdown}\n`);
                setEditorResetRevision((current) => current + 1);
                setDirty(true);
              }}>插入正文</button>
              <button type="button" className="text-button text-button--danger" onClick={() => {
                setAttachmentIds((current) => current.filter((id) => id !== asset.id));
                setDirty(true);
              }}>移除附件</button>
            </span>
          </div>)}
        </div>}
        {state.error && !state.conflict && <p className="form-error" role="alert">{state.error}</p>}
        <div className="form-actions">
          <Link href={cancelHref} className="button button--ghost">取消</Link>
          <button type="submit" className="button button--primary" disabled={pending || saveBlocked || !hydrated}>
            {pending ? "保存中…" : saveBlocked ? "请先处理冲突" : submitLabel}
          </button>
        </div>
      </form>

      <ModalDialog open={discardDraftOpen} title="放弃本地修改？" description="这会删除当前浏览器里尚未提交的内容，且无法撤销。" onClose={() => setDiscardDraftOpen(false)} alert>
        <div className="dialog-actions">
          <button type="button" className="button button--ghost" onClick={() => setDiscardDraftOpen(false)}>继续保留</button>
          <button type="button" className="button button--danger" onClick={() => {
            setDiscardDraftOpen(false);
            setRecoverableDraft(null);
            void removeDraft(userId, draftId);
          }}>放弃本地修改</button>
        </div>
      </ModalDialog>

      <ModalDialog open={conflictOpen} title={confirmChoice ? "确认版本选择" : "检测到编辑冲突"} description={confirmChoice ? undefined : "线上帖子在你编辑期间已被更新。你的本地内容仍然安全。"} onClose={() => {
        setConflictOpen(false);
        setConfirmChoice(null);
        setSaveBlocked(true);
      }} alert>
        {conflict && !confirmChoice && <>
          <div className="conflict-comparison">
            <section><span className="version-label">当前线上版本 · v{conflict.revisionNumber}</span><h3>{conflict.title}</h3><pre>{conflict.markdown}</pre></section>
            <section><span className="version-label">我的版本</span><h3>{title || "（无标题）"}</h3><pre>{markdown}</pre></section>
          </div>
          <div className="dialog-actions dialog-actions--spread">
            <button type="button" className="button button--ghost" onClick={() => {
              setConflictOpen(false);
              setSaveBlocked(true);
            }}>返回编辑手动处理</button>
            <div>
              <button type="button" className="button button--ghost" onClick={() => setConfirmChoice("online")}>使用线上版本</button>
              <button type="button" className="button button--danger" onClick={() => setConfirmChoice("overwrite")}>使用我的版本覆盖</button>
            </div>
          </div>
        </>}
        {conflict && confirmChoice === "online" && <>
          <div className="dialog-confirm-copy"><strong>放弃本地修改并载入线上 v{conflict.revisionNumber}？</strong><p>你的标题、正文、标签和附件选择将替换为当前线上内容。</p></div>
          <div className="dialog-actions"><button type="button" className="button button--ghost" onClick={() => setConfirmChoice(null)}>返回比较</button><button type="button" className="button button--danger" onClick={useOnlineVersion}>放弃本地修改</button></div>
        </>}
        {conflict && confirmChoice === "overwrite" && <>
          <div className="dialog-confirm-copy"><strong>用我的内容覆盖线上 v{conflict.revisionNumber}？</strong><p>不会删除线上版本；系统会基于它创建一个新的 revision。</p></div>
          <div className="dialog-actions"><button type="button" className="button button--ghost" onClick={() => setConfirmChoice(null)}>返回比较</button><button type="button" className="button button--danger" onClick={useMineAndOverwrite}>确认覆盖并保存</button></div>
        </>}
      </ModalDialog>
    </>
  );
}
