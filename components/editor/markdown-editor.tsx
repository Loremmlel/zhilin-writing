"use client";

import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { useEffect, useRef, useState } from "react";

import { createSerialUploadQueue, uploadAsset } from "@/lib/assets/browser-upload";
import { editorSessionKey } from "@/lib/editor/lifecycle";
import { createAnnotationGuardPlugin } from "@/lib/editor/annotation-guard-plugin";
import { annotationPlugin } from "@/lib/editor/annotation-mark";
import type { PendingAnnotationImpact } from "@/lib/editor/annotation-session";
import { AnnotationGuardDialog, type AnnotationGuardMetadata } from "./annotation-guard-dialog";

export type UploadedAsset = {
  id: string;
  filename: string;
  kind: "image" | "attachment";
  url: string;
  markdown: string;
};

export type AnnotationEditingOptions = {
  baseAnnotationIds: string[];
  annotations: AnnotationGuardMetadata[];
  initialConfirmedAnnotationDeletionIds?: string[];
  onConfirmedAnnotationDeletionIdsChange: (ids: string[]) => void;
};

type MarkdownEditorProps = {
  initialMarkdown: string;
  onMarkdownChange: (markdown: string) => void;
  onAssetUploaded?: (asset: UploadedAsset) => void;
  compact?: boolean;
  allowImageUploads?: boolean;
  resetRevision?: number;
  annotationEditing?: AnnotationEditingOptions;
  onEditorRootChange?: (root: HTMLElement | null) => void;
  onUploadStateChange?: (uploading: boolean) => void;
  disabled?: boolean;
};

async function uploadImage(file: File, onProgress: (percent: number) => void, signal: AbortSignal, onAssetUploaded?: (asset: UploadedAsset) => void) {
  const data = await uploadAsset(file, onProgress, signal);
  const asset = { ...data.asset, markdown: data.markdown ?? "" } as UploadedAsset;
  onAssetUploaded?.(asset);
  return asset.url;
}

function MarkdownEditorSession({ initialMarkdown, onMarkdownChange, onAssetUploaded, compact = false, allowImageUploads = true, annotationEditing, onEditorRootChange, onUploadStateChange, disabled = false }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(initialMarkdown);
  const onChangeRef = useRef(onMarkdownChange);
  const uploadRef = useRef(onAssetUploaded);
  const annotationEditingRef = useRef(annotationEditing);
  const onEditorRootChangeRef = useRef(onEditorRootChange);
  const onUploadStateChangeRef = useRef(onUploadStateChange);
  const disabledRef = useRef(disabled);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadQueueRef = useRef(createSerialUploadQueue());
  const queuedUploadCountRef = useRef(0);
  const emittedConfirmedDeletionIdsRef = useRef(annotationEditing?.initialConfirmedAnnotationDeletionIds ?? []);
  const guardRef = useRef<ReturnType<typeof createAnnotationGuardPlugin> | null>(null);
  const [pendingImpact, setPendingImpact] = useState<PendingAnnotationImpact | null>(null);
  const [guardMessage, setGuardMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ filename: string; percent: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => { onChangeRef.current = onMarkdownChange; }, [onMarkdownChange]);
  useEffect(() => { uploadRef.current = onAssetUploaded; }, [onAssetUploaded]);
  useEffect(() => { annotationEditingRef.current = annotationEditing; }, [annotationEditing]);
  useEffect(() => { onEditorRootChangeRef.current = onEditorRootChange; }, [onEditorRootChange]);
  useEffect(() => { onUploadStateChangeRef.current = onUploadStateChange; }, [onUploadStateChange]);
  useEffect(() => {
    disabledRef.current = disabled;
    if (rootRef.current) rootRef.current.inert = disabled || uploadAbortRef.current !== null;
  }, [disabled]);

  useEffect(() => {
    if (!rootRef.current) return;
    onEditorRootChangeRef.current?.(rootRef.current);
    let disposed = false;
    const handleImageUpload = async (file: File) => {
      let controller = uploadAbortRef.current;
      if (!controller || controller.signal.aborted) {
        controller = new AbortController();
        uploadAbortRef.current = controller;
        rootRef.current!.inert = true;
        onUploadStateChangeRef.current?.(true);
        setUploadError(null);
      }
      queuedUploadCountRef.current += 1;
      try {
        return await uploadQueueRef.current(async () => {
          controller.signal.throwIfAborted();
          if (!disposed) setUploadProgress({ filename: file.name, percent: 0 });
          return uploadImage(
            file,
            (percent) => { if (!disposed) setUploadProgress({ filename: file.name, percent }); },
            controller.signal,
            (asset) => { if (!disposed) uploadRef.current?.(asset); },
          );
        });
      } catch (caught) {
        const aborted = caught instanceof DOMException && caught.name === "AbortError";
        if (!aborted) {
          controller.abort();
          if (!disposed) setUploadError(caught instanceof Error ? caught.message : "图片上传失败");
        }
        throw caught;
      } finally {
        queuedUploadCountRef.current = Math.max(0, queuedUploadCountRef.current - 1);
        if (queuedUploadCountRef.current === 0) {
          if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
          if (!disposed) {
            if (rootRef.current) rootRef.current.inert = disabledRef.current;
            setUploadProgress(null);
            onUploadStateChangeRef.current?.(false);
          }
        }
      }
    };
    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: initialMarkdownRef.current,
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.CodeMirror]: false,
        [CrepeFeature.ImageBlock]: !compact && allowImageUploads,
        [CrepeFeature.Table]: !compact,
        [CrepeFeature.BlockEdit]: !compact,
        [CrepeFeature.TopBar]: !compact,
      },
      featureConfigs: {
        [CrepeFeature.Placeholder]: {
          text: compact ? "写下回复……" : "从这里开始写作……",
          mode: "block",
        },
        [CrepeFeature.ImageBlock]: {
          onUpload: handleImageUpload,
          inlineOnUpload: handleImageUpload,
          blockOnUpload: handleImageUpload,
        },
      },
    });
    crepe.editor.use(annotationPlugin);
    const guardOptions = annotationEditingRef.current;
    if (guardOptions) {
      const guard = createAnnotationGuardPlugin({
        baseAnnotationIds: guardOptions.baseAnnotationIds,
        initialConfirmedAnnotationDeletionIds: guardOptions.initialConfirmedAnnotationDeletionIds,
        onPendingImpact: (pending) => {
          if (disposed) return;
          setGuardMessage(null);
          setPendingImpact(pending);
        },
        onStateChange: ({ pending, confirmedAnnotationDeletionIds }) => {
          if (disposed) return;
          setPendingImpact(pending);
          const previous = emittedConfirmedDeletionIdsRef.current;
          if (previous.length !== confirmedAnnotationDeletionIds.length || previous.some((id, index) => id !== confirmedAnnotationDeletionIds[index])) {
            emittedConfirmedDeletionIdsRef.current = confirmedAnnotationDeletionIds;
            annotationEditingRef.current?.onConfirmedAnnotationDeletionIdsChange(confirmedAnnotationDeletionIds);
          }
        },
      });
      guardRef.current = guard;
      crepe.editor.use(guard.milkdownPlugin);
    }
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previous) => {
        if (!disposed && markdown !== previous) onChangeRef.current(markdown);
      });
    });
    void crepe.create();
    return () => {
      disposed = true;
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      onUploadStateChangeRef.current?.(false);
      onEditorRootChangeRef.current?.(null);
      guardRef.current?.discard();
      guardRef.current = null;
      window.setTimeout(() => void crepe.destroy(), 0);
    };
  }, [allowImageUploads, compact]);

  return <>
    <div ref={rootRef} className={compact ? "markdown-editor markdown-editor--compact" : "markdown-editor"} aria-busy={uploadProgress !== null} aria-disabled={disabled} />
    {uploadProgress !== null && <div className="upload-progress upload-progress--editor" role="status" aria-live="polite">
      <div><span>当前图片上传进度 · {uploadProgress.filename}</span><strong>{uploadProgress.percent}%</strong></div>
      <progress max={100} value={uploadProgress.percent} aria-label="图片上传进度" />
    </div>}
    {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
    <AnnotationGuardDialog
      pending={pendingImpact}
      annotations={annotationEditing?.annotations ?? []}
      message={guardMessage}
      onCancel={() => {
        if (pendingImpact) guardRef.current?.cancelPending(pendingImpact.token);
        setPendingImpact(null);
        setGuardMessage(null);
      }}
      onConfirm={() => {
        if (!pendingImpact) return;
        const result = guardRef.current?.confirmPending(pendingImpact.token);
        if (result?.kind !== "CLIPBOARD_ERROR") setPendingImpact(null);
        if (result?.kind === "STALE" || result?.kind === "REENTER_COMPOSITION" || result?.kind === "CLIPBOARD_ERROR") {
          setGuardMessage(result.message);
        } else {
          setGuardMessage(null);
        }
      }}
    />
    {guardMessage && !pendingImpact && <p className="annotation-guard-status" role="status">{guardMessage}</p>}
  </>;
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const compact = props.compact ?? false;
  const resetRevision = props.resetRevision ?? 0;
  const sessionKey = editorSessionKey({
    compact,
    resetRevision,
    markdown: props.initialMarkdown,
  });

  return <MarkdownEditorSession key={sessionKey} {...props} compact={compact} />;
}
