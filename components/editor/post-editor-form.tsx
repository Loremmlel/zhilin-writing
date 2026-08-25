"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { loadDraft, removeDraft, saveDraft, type LocalDraft } from "@/lib/drafts/indexed-db";
import { MarkdownEditor, type UploadedAsset } from "./markdown-editor";

export type PostActionState = { error?: string; postId?: string };
export type PostFormAction = (state: PostActionState, formData: FormData) => Promise<PostActionState>;

type PostEditorFormProps = {
  userId: string;
  draftId: string;
  action: PostFormAction;
  initial?: { title: string; markdown: string; tags: string[]; assetIds?: string[] };
  submitLabel?: string;
  cancelHref?: string;
};

export function PostEditorForm({ userId, draftId, action, initial, submitLabel = "发布帖子", cancelHref = "/" }: PostEditorFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [title, setTitle] = useState(initial?.title ?? "");
  const [markdown, setMarkdown] = useState(initial?.markdown ?? "");
  const [tags, setTags] = useState(initial?.tags.join("，") ?? "");
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [assetIds, setAssetIds] = useState(initial?.assetIds ?? []);
  const [editorResetRevision, setEditorResetRevision] = useState(0);
  const [draftStatus, setDraftStatus] = useState<"loading" | "saving" | "saved" | "failed">("loading");
  const [hydrated, setHydrated] = useState(false);
  const editorKey = `${draftId}:${hydrated ? "ready" : "initial"}`;

  useEffect(() => {
    let live = true;
    void loadDraft(userId, draftId).then((draft) => {
      if (!live) return;
      if (draft) {
        setTitle(draft.title);
        setMarkdown(draft.markdown);
        setTags(draft.tags);
        setAssetIds(draft.assetIds);
      }
      setHydrated(true);
      setDraftStatus("saved");
    }).catch(() => setDraftStatus("failed"));
    return () => { live = false; };
  }, [draftId, userId]);

  useEffect(() => {
    if (!hydrated || state.postId) return;
    const statusTimer = window.setTimeout(() => setDraftStatus("saving"), 0);
    const timer = window.setTimeout(() => {
      const draft: LocalDraft = { title, markdown, tags, assetIds, updatedAt: Date.now() };
      void saveDraft(userId, draftId, draft)
        .then(() => setDraftStatus("saved"))
        .catch(() => setDraftStatus("failed"));
    }, 700);
    return () => {
      window.clearTimeout(statusTimer);
      window.clearTimeout(timer);
    };
  }, [assetIds, draftId, hydrated, markdown, state.postId, tags, title, userId]);

  useEffect(() => {
    if (!state.postId) return;
    void removeDraft(userId, draftId).finally(() => router.push(`/posts/${state.postId}`));
  }, [draftId, router, state.postId, userId]);

  async function uploadAttachment(file: File) {
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/assets", { method: "POST", body: formData });
    const data = await response.json() as { error?: string; asset?: UploadedAsset; markdown?: string };
    if (!response.ok || !data.asset) throw new Error(data.error ?? "上传失败");
    const asset = { ...data.asset, markdown: data.markdown ?? "" } as UploadedAsset;
    setAssets((current) => [...current, asset]);
    setAssetIds((current) => [...new Set([...current, asset.id])]);
  }

  return (
    <form action={formAction} className="editor-form">
      <input type="hidden" name="markdown" value={markdown} />
      <input type="hidden" name="assetIds" value={JSON.stringify(assetIds)} />
      <div className="editor-topline">
        <span className={`draft-status draft-status--${draftStatus}`}>
          {draftStatus === "loading" && "恢复草稿…"}
          {draftStatus === "saving" && "保存中…"}
          {draftStatus === "saved" && "已保存到本地"}
          {draftStatus === "failed" && "本地保存失败"}
        </span>
        <span>Markdown 将作为正文的唯一存储格式</span>
      </div>
      <label className="field-label" htmlFor="post-title">标题</label>
      <input id="post-title" className="title-input" name="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="给这篇文字起一个标题" required />
      <label className="field-label">正文</label>
      <MarkdownEditor key={editorKey} initialMarkdown={markdown} resetRevision={editorResetRevision} onMarkdownChange={setMarkdown} onAssetUploaded={(asset) => {
        setAssets((current) => [...current, asset]);
        setAssetIds((current) => [...new Set([...current, asset.id])]);
      }} />
      <div className="editor-subgrid">
        <label>
          <span className="field-label">标签（最多 5 个，用逗号分隔）</span>
          <input className="text-input" name="tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="随笔，生活" />
        </label>
        <label className="attachment-upload">
          <span className="field-label">附件</span>
          <input type="file" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadAttachment(file).catch((error) => window.alert(error instanceof Error ? error.message : "上传失败"));
            event.currentTarget.value = "";
          }} />
          <span className="muted">上传到文件区；可插入正文链接。</span>
        </label>
      </div>
      {assets.length > 0 && <div className="asset-list">
        {assets.map((asset) => <div key={asset.id} className="asset-row">
          <span>{asset.filename}</span>
          <button type="button" className="text-button" onClick={() => {
            setMarkdown((current) => `${current.trimEnd()}\n\n${asset.markdown}\n`);
            setEditorResetRevision((current) => current + 1);
          }}>插入正文</button>
        </div>)}
      </div>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <div className="form-actions">
        <Link href={cancelHref} className="button button--ghost">取消</Link>
        <button type="submit" className="button button--primary" disabled={pending}>{pending ? "提交中…" : submitLabel}</button>
      </div>
    </form>
  );
}
