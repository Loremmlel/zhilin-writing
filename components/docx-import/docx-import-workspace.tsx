"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { DocxImportPreview } from "@/components/docx-import/docx-import-preview";
import { ModalDialog } from "@/components/modal-dialog";
import {
  finalizeDocxPreview,
  parseDocxWithWorker,
  sha256DocxSource,
} from "@/lib/docx-import/browser";
import { DOCX_IMPORT_LIMITS } from "@/lib/docx-import/limits";
import {
  listImportPreviews,
  removeImportPreview,
  saveImportPreview,
} from "@/lib/docx-import/preview-store";
import {
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
};

export function DocxImportWorkspace({ users }: { users: SiteUser[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    let live = true;
    void listImportPreviews().then((items) => { if (live) setRecoverable(items); });
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
        .then(() => setError((current) => current?.code === "PREVIEW_SAVE_FAILED" ? null : current))
        .catch(() => setError({ code: "PREVIEW_SAVE_FAILED", message: "预览未能保存到当前浏览器。" }));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [phase, preview]);

  const validation = useMemo(() => preview ? validateEditedImportPreview(preview) : null, [preview]);

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
      const temporaryAssets: DocxPreviewAsset[] = [];
      let markdown = ir.canonicalMarkdown;
      for (const [index, asset] of ir.assets.entries()) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const uploaded = await uploadImageAsset(asset, controller.signal);
        temporaryAssets.push(uploaded);
        markdown = markdown.replaceAll(`docx-asset:${asset.id}`, uploaded.temporaryUrl);
        setUploadedCount(index + 1);
      }
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
      await saveImportPreview(record, now);
      setPreview(toEditable(record, users));
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

  function restorePreview(record: DocxPreviewRecord) {
    const editable = toEditable(record, users);
    const restoredValidation = validateEditedImportPreview(editable);
    if (!restoredValidation.ok && restoredValidation.errors.some((item) => item.code === "PREVIEW_EXPIRED")) {
      void removeImportPreview(record.importBatchId);
      setRecoverable((items) => items.filter((item) => item.importBatchId !== record.importBatchId));
      setError({ code: "PREVIEW_EXPIRED", message: "Preview expired" });
      return;
    }
    setError(null);
    setPreview(editable);
    setPhase("previewing");
  }

  async function discardPreview(batchId: string) {
    discardedRef.current.add(batchId);
    await removeImportPreview(batchId);
    setRecoverable((items) => items.filter((item) => item.importBatchId !== batchId));
    if (preview?.importBatchId === batchId) {
      setPreview(null);
      setPhase("selecting");
    }
    setDiscardBatchId(null);
  }

  return <section className="docx-import-workspace" aria-busy={phase === "parsing" || phase === "uploading" || phase === "committing"}>
    {phase === "selecting" && <>
      {recoverable.length > 0 && <section className="docx-import-recovery" aria-labelledby="docx-recovery-heading">
        <div className="section-heading"><h2 id="docx-recovery-heading">继续未完成的导入</h2><span>保留 24 小时</span></div>
        <div className="docx-import-recovery-list">{recoverable.map((record) => <article key={record.importBatchId}>
          <div><strong>{record.title ?? record.ir.suggestedTitle}</strong><span>{record.ir.source.filename}</span></div>
          <div><button type="button" className="button button--small button--ghost" onClick={() => restorePreview(record)}>继续预览</button><button type="button" className="text-button text-button--danger" onClick={() => setDiscardBatchId(record.importBatchId)}>放弃</button></div>
        </article>)}</div>
      </section>}

      <div className={`docx-import-dropzone${dragOver ? " is-drag-over" : ""}`}
        role="button" tabIndex={0} aria-label="选择 DOCX 文件"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files[0]; if (file) void beginImport(file); }}>
        <input ref={inputRef} type="file" aria-label="选择 DOCX 文件" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onClick={(event) => event.stopPropagation()} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void beginImport(file);
          event.currentTarget.value = "";
        }} />
        <span className="docx-import-file-mark" aria-hidden="true">DOCX</span>
        <h2>选择 DOCX 文件</h2>
        <p>拖到这里，或点击浏览文件。一次选择 1 个，最大 20 MB。</p>
        <small>解析在浏览器内完成；原始 DOCX 不会上传。</small>
      </div>

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
        onMappingChange={(sourceAuthorName, userId) => setPreview((current) => current ? { ...current, authorMappings: { ...current.authorMappings, [sourceAuthorName]: userId } } : current)} />
      <div className="docx-import-actions">
        <button type="button" className="button button--ghost" onClick={() => setDiscardBatchId(preview.importBatchId)}>取消导入</button>
        <div><span>{validation.ok ? "预览已通过本地校验" : `还有 ${validation.errors.length} 项需要修正`}</span><button type="button" className="button button--primary" disabled aria-disabled="true">确认导入</button></div>
      </div>
    </>}

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

function toEditable(record: DocxPreviewRecord, users: SiteUser[]): EditedImportPreview {
  const validUserIds = new Set(users.map((user) => user.id));
  const validAuthors = new Set(record.ir.threads.flatMap((thread) => [thread.sourceAuthorName, ...thread.replies.map((reply) => reply.sourceAuthorName)]));
  const authorMappings = Object.fromEntries(Object.entries(record.authorMappings).filter(([author, userId]) => validAuthors.has(author) && validUserIds.has(userId)));
  return { ...record, title: record.title ?? record.ir.suggestedTitle, markdown: record.canonicalMarkdown, authorMappings };
}

function progressValue(stage: DocxWorkerProgressStage) {
  return ["package-validation", "xml-preload", "document-walk", "thread-validation", "markdown-generation", "done"].indexOf(stage) + 1;
}
