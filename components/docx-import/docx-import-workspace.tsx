"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { DocxImportPreview } from "@/components/docx-import/docx-import-preview";
import { ModalDialog } from "@/components/modal-dialog";
import {
  finalizeDocxPreview,
  parseDocxWithWorker,
  sha256DocxSource,
} from "@/lib/docx-import/browser";
import { beginDocxImportCommit } from "@/lib/docx-import/commit-lock";
import { prepareDocxImportSubmission } from "@/lib/docx-import/commit-schema";
import { DOCX_IMPORT_LIMITS } from "@/lib/docx-import/limits";
import {
  replaceDocxAssetReferences,
  uploadDocxAssetsSequentially,
} from "@/lib/docx-import/preview-assets";
import {
  listImportPreviews,
  removeImportPreview,
  saveImportPreview,
} from "@/lib/docx-import/preview-store";
import {
  normalizeAuthorMappings,
  validateEditedImportPreview,
  type EditedImportPreview,
} from "@/lib/docx-import/preview-validation";
import type { DocxPreviewAsset, DocxPreviewRecord } from "@/lib/docx-import/types";
import type { DocxWorkerProgressStage } from "@/lib/docx-import/worker-protocol";

type Phase = "selecting" | "parsing" | "uploading" | "previewing" | "committing" | "complete";
type SiteUser = { id: string; displayName: string };

const stageLabels: Record<DocxWorkerProgressStage, string> = {
  "package-validation": "检查 DOCX 文件结构",
  "xml-preload": "读取文档关系与样式",
  "document-walk": "解析正文、表格与图片",
  "thread-validation": "核对批注与回复",
  "markdown-generation": "生成 Markdown 预览",
  done: "解析完成",
};

const errorLabels: Record<string, string> = {
  INVALID_EXTENSION: "请选择扩展名为 .docx 的文件。",
  FILE_SIZE_LIMIT: "DOCX 文件不能超过 20 MB。",
  PARSE_ABORTED: "导入已取消，原始文件没有上传。",
  PARSE_TIMEOUT: "解析超过 20 秒。可以重试，或先在 Word 中精简文档。",
  ZIP_ENCRYPTED_ENTRY: "该 DOCX 已加密或受密码保护，暂时无法导入。",
  IMAGE_SIZE_LIMIT: "文档中有图片超过 10 MB。",
  IMAGE_COUNT_LIMIT: "文档中的图片数量超过 200 张。",
  PREVIEW_LOAD_FAILED: "无法读取当前浏览器中保存的导入预览。",
  PREVIEW_REMOVE_FAILED: "无法删除当前浏览器中的导入预览，请重试。",
  AUTH_REQUIRED: "登录状态已失效。预览仍保存在本地，请重新登录。",
  MEMBER_REQUIRED: "当前账号已失去导入权限。预览仍保存在本地。",
  ONBOARDING_REQUIRED: "请先完成站内资料设置。预览仍保存在本地。",
  IMPORT_BATCH_CONFLICT: "这份预览与已提交的内容不一致，请重新选择 DOCX。",
  ATTRIBUTED_USER_INVALID: "批注作者关联已失效，请重新选择。",
  ASSET_NOT_CLAIMABLE: "预览图片已失效，请重新导入 DOCX。",
  IMPORT_COMMIT_FAILED: "未能完成导入。预览和临时图片仍保留，可以重试。",
  COMMIT_REQUEST_FAILED: "未能完成导入。预览仍保存在本地，可以重试。",
};

export function DocxImportWorkspace({ users }: { users: SiteUser[] }) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const commitInFlightRef = useRef(false);
  const discardedRef = useRef(new Set<string>());
  const [phase, setPhase] = useState<Phase>("selecting");
  const [preview, setPreview] = useState<EditedImportPreview | null>(null);
  const [recoverable, setRecoverable] = useState<DocxPreviewRecord[]>([]);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [stage, setStage] = useState<DocxWorkerProgressStage>("package-validation");
  const [uploadedCount, setUploadedCount] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [discardBatchId, setDiscardBatchId] = useState<string | null>(null);
  const [validationNow, setValidationNow] = useState(() => Date.now());
  const validUserIds = useMemo(() => new Set(users.map((user) => user.id)), [users]);

  useEffect(() => {
    let live = true;
    void listImportPreviews()
      .then((items) => { if (live) setRecoverable(items); })
      .catch(() => { if (live) setError({ code: "PREVIEW_LOAD_FAILED", message: "Preview load failed" }); });
    return () => { live = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!preview || phase !== "previewing") return;
    const timer = window.setTimeout(() => {
      if (discardedRef.current.has(preview.importBatchId)) return;
      const record: DocxPreviewRecord = {
        ...preview,
        title: preview.title,
        canonicalMarkdown: preview.markdown,
        ir: { ...preview.ir, canonicalMarkdown: preview.markdown },
      };
      void saveImportPreview(record)
        .then(async () => {
          if (discardedRef.current.has(record.importBatchId)) {
            await removePreviewRecord(record.importBatchId);
            return;
          }
          setError((current) => current?.code === "PREVIEW_SAVE_FAILED" ? null : current);
        })
        .catch(() => setError({ code: "PREVIEW_SAVE_FAILED", message: "预览未能保存到当前浏览器。" }));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [phase, preview]);

  useEffect(() => {
    if (!preview) return;
    const expiresAt = Date.parse(preview.expiresAt);
    const delay = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now() + 1) : 0;
    const timer = window.setTimeout(() => setValidationNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [preview]);

  const validation = useMemo(
    () => preview ? validateEditedImportPreview(preview, validationNow, validUserIds) : null,
    [preview, validationNow, validUserIds],
  );

  async function beginImport(file: File) {
    const clientError = validateSourceFile(file);
    if (clientError) {
      setError(clientError);
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLastFile(file);
    setError(null);
    setPreview(null);
    setStage("package-validation");
    setPhase("parsing");
    try {
      const [parsed, sha256] = await Promise.all([
        parseDocxWithWorker(file, { signal: controller.signal, onProgress: setStage }),
        sha256DocxSource(file),
      ]);
      const ir = finalizeDocxPreview(parsed, { importBatchId: crypto.randomUUID(), sourceSha256: sha256 });
      setPhase("uploading");
      setUploadTotal(ir.assets.length);
      setUploadedCount(0);
      const uploadedAssets = await uploadDocxAssetsSequentially(
        ir.assets,
        controller.signal,
        uploadImageAsset,
        setUploadedCount,
      );
      const temporaryAssets = uploadedAssets.map(({ uploaded }) => uploaded);
      const markdown = replaceDocxAssetReferences(ir.canonicalMarkdown, uploadedAssets);
      const now = Date.now();
      const record: DocxPreviewRecord = {
        version: 1,
        importBatchId: ir.importBatchId,
        title: ir.suggestedTitle,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + DOCX_IMPORT_LIMITS.previewTtlMs).toISOString(),
        ir: { ...ir, canonicalMarkdown: markdown },
        canonicalMarkdown: markdown,
        temporaryAssets,
        authorMappings: {},
      };
      await saveImportPreview(record, now, controller.signal);
      controller.signal.throwIfAborted();
      setPreview(toEditable(record));
      setRecoverable((items) => [record, ...items.filter((item) => item.importBatchId !== record.importBatchId)]);
      setPhase("previewing");
    } catch (caught) {
      const code = caught instanceof DOMException && caught.name === "AbortError"
        ? "PARSE_ABORTED"
        : typeof caught === "object" && caught && "code" in caught ? String(caught.code) : "PARSE_FAILED";
      setError({ code, message: caught instanceof Error ? caught.message : "DOCX 解析失败" });
      setPhase("selecting");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancelActiveImport() {
    abortRef.current?.abort();
  }

  async function removePreviewRecord(batchId: string): Promise<boolean> {
    try {
      await removeImportPreview(batchId);
      return true;
    } catch {
      setError({ code: "PREVIEW_REMOVE_FAILED", message: "Preview removal failed" });
      return false;
    }
  }

  async function restorePreview(record: DocxPreviewRecord, now: number) {
    const editable = toEditable(record);
    const restoredValidation = validateEditedImportPreview(editable, now, validUserIds);
    if (!restoredValidation.ok && restoredValidation.errors.some((item) => item.code === "PREVIEW_EXPIRED")) {
      if (!await removePreviewRecord(record.importBatchId)) return;
      setRecoverable((items) => items.filter((item) => item.importBatchId !== record.importBatchId));
      setError({ code: "PREVIEW_EXPIRED", message: "Preview expired" });
      return;
    }
    setError(null);
    setValidationNow(now);
    setPreview(editable);
    setPhase("previewing");
  }

  async function discardPreview(batchId: string) {
    discardedRef.current.add(batchId);
    if (await removePreviewRecord(batchId)) {
      setRecoverable((items) => items.filter((item) => item.importBatchId !== batchId));
      if (preview?.importBatchId === batchId) {
        setPreview(null);
        setPhase("selecting");
      }
    } else {
      discardedRef.current.delete(batchId);
    }
    setDiscardBatchId(null);
  }

  async function confirmImport() {
    if (!preview || !validation?.ok) return;
    const submission = prepareDocxImportSubmission(validation.payload);
    if (!beginDocxImportCommit(commitInFlightRef, () => setPhase("committing"))) return;
    setError(null);
    try {
      await saveImportPreview(submission.preview);
    } catch {
      commitInFlightRef.current = false;
      setError({ code: "PREVIEW_SAVE_FAILED", message: "预览未能保存到当前浏览器。" });
      setPhase("previewing");
      return;
    }
    try {
      const response = await fetch("/api/docx-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: submission.body,
      });
      const data = await response.json() as {
        result?: { postId: string };
        error?: { code?: string; message?: string };
      };
      if (!response.ok || !data.result) {
        throw Object.assign(new Error(data.error?.message ?? "导入提交失败"), {
          code: data.error?.code ?? "COMMIT_REQUEST_FAILED",
        });
      }
      discardedRef.current.add(preview.importBatchId);
      try { await removeImportPreview(preview.importBatchId); }
      catch { /* The committed post is authoritative; an exact retry remains idempotent. */ }
      setRecoverable((items) => items.filter((item) => item.importBatchId !== preview.importBatchId));
      setPhase("complete");
      router.push(`/posts/${data.result.postId}`);
      router.refresh();
    } catch (caught) {
      commitInFlightRef.current = false;
      const code = typeof caught === "object" && caught && "code" in caught
        ? String(caught.code)
        : "COMMIT_REQUEST_FAILED";
      setError({ code, message: caught instanceof Error ? caught.message : "导入提交失败" });
      setPhase("previewing");
    }
  }

  return <section className="docx-import-workspace" aria-busy={phase === "parsing" || phase === "uploading" || phase === "committing"}>
    {phase === "selecting" && <>
      {recoverable.length > 0 && <section className="docx-import-recovery" aria-labelledby="docx-recovery-heading">
        <div className="section-heading"><h2 id="docx-recovery-heading">继续未完成的导入</h2><span>保留 24 小时</span></div>
        <div className="docx-import-recovery-list">{recoverable.map((record) => <article key={record.importBatchId}>
          <div><strong>{record.title ?? record.ir.suggestedTitle}</strong><span>{record.ir.source.filename}</span></div>
          <div><button type="button" className="button button--small button--ghost" onClick={() => void restorePreview(record, Date.now())}>继续预览</button><button type="button" className="text-button text-button--danger" onClick={() => setDiscardBatchId(record.importBatchId)}>放弃</button></div>
        </article>)}</div>
      </section>}

      <label className={`docx-import-dropzone${dragOver ? " is-drag-over" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files[0]; if (file) void beginImport(file); }}>
        <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void beginImport(file);
          event.currentTarget.value = "";
        }} />
        <span className="docx-import-file-mark" aria-hidden="true">DOCX</span>
        <h2>选择 DOCX 文件</h2>
        <p>拖到这里，或点击浏览文件。一次选择 1 个，最大 20 MB。</p>
        <small>解析在浏览器内完成；原始 DOCX 不会上传。</small>
      </label>

      {error && <div className="docx-import-error" role="alert">
        <div><strong>未能准备预览</strong><p>{errorLabels[error.code] ?? error.message}</p></div>
        {lastFile && error.code !== "INVALID_EXTENSION" && error.code !== "FILE_SIZE_LIMIT" && <button type="button" className="button button--ghost button--small" onClick={() => void beginImport(lastFile)}>重试</button>}
      </div>}
    </>}

    {(phase === "parsing" || phase === "uploading") && <section className="docx-import-progress" role="status" aria-live="polite" aria-labelledby="docx-progress-heading">
      <span className="docx-import-file-mark" aria-hidden="true">DOCX</span>
      <div>
        <span className="eyebrow">解析进度</span>
        <h2 id="docx-progress-heading">{phase === "parsing" ? stageLabels[stage] : "上传预览图片"}</h2>
        <p>{phase === "parsing" ? "正在本地读取正文结构与批注关系。" : `已上传 ${uploadedCount} / ${uploadTotal} 张图片。`}</p>
      </div>
      <progress max={phase === "parsing" ? 6 : Math.max(1, uploadTotal)} value={phase === "parsing" ? progressValue(stage) : uploadedCount} aria-label={phase === "parsing" ? stageLabels[stage] : "图片上传进度"} />
      <button type="button" className="button button--ghost" onClick={cancelActiveImport}>取消导入</button>
    </section>}

    {phase === "previewing" && preview && validation && <>
      {error && <div className="docx-import-error" role="alert"><div><strong>本地预览状态</strong><p>{errorLabels[error.code] ?? error.message}</p></div></div>}
      <DocxImportPreview preview={preview} users={users} validation={validation}
        onTitleChange={(title) => setPreview((current) => current ? { ...current, title } : current)}
        onMarkdownChange={(markdown) => setPreview((current) => current ? { ...current, markdown } : current)}
        onMappingChange={(sourceAuthorName, userId) => setPreview((current) => {
          if (!current) return current;
          const authorMappings = { ...current.authorMappings };
          if (userId) authorMappings[sourceAuthorName] = userId;
          else delete authorMappings[sourceAuthorName];
          return { ...current, authorMappings };
        })} />
      <div className="docx-import-actions">
        <button type="button" className="button button--ghost" onClick={() => setDiscardBatchId(preview.importBatchId)}>取消导入</button>
        <div><span>{validation.ok ? "预览已通过本地校验" : `还有 ${validation.errors.length} 项需要修正`}</span><button type="button" className="button button--primary" disabled={!validation.ok} aria-disabled={!validation.ok} onClick={() => void confirmImport()}>确认导入</button></div>
      </div>
    </>}

    {phase === "committing" && <section className="docx-import-progress" role="status" aria-live="polite" aria-labelledby="docx-commit-heading">
      <span className="docx-import-file-mark" aria-hidden="true">DOCX</span>
      <div>
        <span className="eyebrow">保存进度</span>
        <h2 id="docx-commit-heading">正在保存帖子</h2>
        <p>正在一次写入正文、批注和图片关系，请勿关闭页面。</p>
      </div>
      <progress aria-label="正在保存帖子" />
    </section>}

    {phase === "complete" && <div className="empty-state"><h2>导入完成</h2><p>正在打开新帖子。</p></div>}

    <ModalDialog open={Boolean(discardBatchId)} title="放弃这份 DOCX 预览？" description="这会删除当前浏览器里保存的预览；已经上传的临时图片会由站点自动回收。" onClose={() => setDiscardBatchId(null)} alert>
      <div className="dialog-actions"><button type="button" className="button button--ghost" onClick={() => setDiscardBatchId(null)}>继续保留</button><button type="button" className="button button--danger" onClick={() => { if (discardBatchId) void discardPreview(discardBatchId); }}>放弃预览</button></div>
    </ModalDialog>
  </section>;
}

function validateSourceFile(file: File) {
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".docx")) return { code: "INVALID_EXTENSION", message: "Invalid extension" };
  if (file.size <= 0 || file.size > DOCX_IMPORT_LIMITS.compressedBytes) return { code: "FILE_SIZE_LIMIT", message: "Invalid file size" };
  return null;
}

async function uploadImageAsset(asset: DocxPreviewRecord["ir"]["assets"][number], signal: AbortSignal): Promise<DocxPreviewAsset> {
  const formData = new FormData();
  formData.set("file", new File([asset.bytes as Uint8Array<ArrayBuffer>], asset.filename, { type: asset.mimeType }));
  const response = await fetch("/api/assets", { method: "POST", body: formData, signal });
  const data = await response.json() as { error?: string; asset?: { id: string; filename: string; mimeType: string; url: string } };
  if (!response.ok || !data.asset) throw new Error(data.error ?? `图片 ${asset.filename} 上传失败`);
  return { assetId: data.asset.id, temporaryUrl: data.asset.url, filename: data.asset.filename, mimeType: asset.mimeType };
}

function toEditable(record: DocxPreviewRecord): EditedImportPreview {
  const validAuthors = new Set(record.ir.threads.flatMap((thread) => [thread.sourceAuthorName, ...thread.replies.map((reply) => reply.sourceAuthorName)]));
  const authorMappings = Object.fromEntries(
    Object.entries(normalizeAuthorMappings(record.authorMappings)).filter(([author]) => validAuthors.has(author)),
  );
  return { ...record, title: record.title ?? record.ir.suggestedTitle, markdown: record.canonicalMarkdown, authorMappings };
}

function progressValue(stage: DocxWorkerProgressStage) {
  return ["package-validation", "xml-preload", "document-walk", "thread-validation", "markdown-generation", "done"].indexOf(stage) + 1;
}
