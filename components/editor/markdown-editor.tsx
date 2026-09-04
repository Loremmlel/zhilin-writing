"use client";

import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { imageBlockConfig } from "@milkdown/kit/component/image-block";
import { editorViewCtx } from "@milkdown/kit/core";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
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

export type MarkdownEditorProps = {
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

type ImageUploadTask = {
  id: string;
  filename: string;
  status: "uploading" | "failed";
  percent: number;
  error?: string;
};

async function uploadImage(
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
  onAssetUploaded?: (asset: UploadedAsset) => void,
) {
  const data = await uploadAsset(file, onProgress, signal);
  const asset = { ...data.asset, markdown: data.markdown ?? "" } as UploadedAsset;
  onAssetUploaded?.(asset);
  return asset.url;
}

function MarkdownEditorSession({
  initialMarkdown,
  onMarkdownChange,
  onAssetUploaded,
  compact = false,
  allowImageUploads = true,
  annotationEditing,
  onEditorRootChange,
  onUploadStateChange,
  disabled = false,
}: MarkdownEditorProps) {
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
  const failedImageFilesRef = useRef(new Map<string, File>());
  const retryImageUploadRef = useRef<((taskId: string) => Promise<void>) | null>(null);
  const emittedConfirmedDeletionIdsRef = useRef(
    annotationEditing?.initialConfirmedAnnotationDeletionIds ?? [],
  );
  const guardRef = useRef<ReturnType<typeof createAnnotationGuardPlugin> | null>(null);
  const [initializationState, setInitializationState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [pendingImpact, setPendingImpact] = useState<PendingAnnotationImpact | null>(null);
  const [guardMessage, setGuardMessage] = useState<string | null>(null);
  const [imageUploadTasks, setImageUploadTasks] = useState<ImageUploadTask[]>([]);

  useEffect(() => {
    onChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);
  useEffect(() => {
    uploadRef.current = onAssetUploaded;
  }, [onAssetUploaded]);
  useEffect(() => {
    annotationEditingRef.current = annotationEditing;
  }, [annotationEditing]);
  useEffect(() => {
    onEditorRootChangeRef.current = onEditorRootChange;
  }, [onEditorRootChange]);
  useEffect(() => {
    onUploadStateChangeRef.current = onUploadStateChange;
  }, [onUploadStateChange]);
  useEffect(() => {
    disabledRef.current = disabled;
    if (rootRef.current) rootRef.current.inert = disabled || uploadAbortRef.current !== null;
  }, [disabled]);

  useEffect(() => {
    if (!rootRef.current) return;
    const failedImageFiles = failedImageFilesRef.current;
    let disposed = false;
    let created = false;
    const performImageUpload = async (taskId: string, file: File) => {
      let controller = uploadAbortRef.current;
      if (!controller || controller.signal.aborted) {
        controller = new AbortController();
        uploadAbortRef.current = controller;
        rootRef.current!.inert = true;
        onUploadStateChangeRef.current?.(true);
      }
      if (!disposed)
        setImageUploadTasks((current) => [
          ...current.filter((task) => task.id !== taskId),
          { id: taskId, filename: file.name, status: "uploading", percent: 0 },
        ]);
      queuedUploadCountRef.current += 1;
      try {
        return await uploadQueueRef.current(async () => {
          controller.signal.throwIfAborted();
          return uploadImage(
            file,
            (percent) => {
              if (!disposed)
                setImageUploadTasks((current) =>
                  current.map((task) => (task.id === taskId ? { ...task, percent } : task)),
                );
            },
            controller.signal,
            (asset) => {
              if (!disposed) uploadRef.current?.(asset);
            },
          );
        });
      } catch (caught) {
        const aborted = caught instanceof DOMException && caught.name === "AbortError";
        if (!disposed) {
          if (aborted) {
            setImageUploadTasks((current) => current.filter((task) => task.id !== taskId));
          } else {
            failedImageFilesRef.current.set(taskId, file);
            setImageUploadTasks((current) =>
              current.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      status: "failed",
                      error: caught instanceof Error ? caught.message : "图片上传失败，请稍后重试",
                    }
                  : task,
              ),
            );
          }
        }
        throw caught;
      } finally {
        queuedUploadCountRef.current = Math.max(0, queuedUploadCountRef.current - 1);
        if (queuedUploadCountRef.current === 0) {
          if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
          if (!disposed) {
            if (rootRef.current) rootRef.current.inert = disabledRef.current;
            onUploadStateChangeRef.current?.(false);
          }
        }
      }
    };
    const handleImageUpload = async (file: File) => {
      const taskId = crypto.randomUUID();
      try {
        const url = await performImageUpload(taskId, file);
        if (!disposed)
          setImageUploadTasks((current) => current.filter((task) => task.id !== taskId));
        return url;
      } catch (error) {
        throw error;
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
    crepe.editor.config((ctx) => {
      ctx.update(uploadConfig.key, (previous) => ({
        ...previous,
        uploader: async (files, schema, uploadContext) => {
          const nodeType = schema.nodes["image-block"] ?? schema.nodes.image;
          if (!nodeType) return [];
          const onUpload = uploadContext.get(imageBlockConfig.key).onUpload;
          const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
          const results = await Promise.allSettled(images.map((file) => onUpload(file)));
          return results.flatMap((result) => {
            if (result.status === "rejected") return [];
            const node = nodeType.createAndFill({ src: result.value });
            return node ? [node] : [];
          });
        },
      }));
    });
    retryImageUploadRef.current = async (taskId) => {
      const file = failedImageFilesRef.current.get(taskId);
      if (!file || disposed) return;
      try {
        const src = await performImageUpload(taskId, file);
        if (disposed) return;
        failedImageFilesRef.current.delete(taskId);
        setImageUploadTasks((current) => current.filter((task) => task.id !== taskId));
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const nodeType = view.state.schema.nodes["image-block"] ?? view.state.schema.nodes.image;
          const node = nodeType?.createAndFill({ src });
          if (node) view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
        });
      } catch {
        // The per-file task keeps its typed error and remains retryable.
      }
    };
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
          if (
            previous.length !== confirmedAnnotationDeletionIds.length ||
            previous.some((id, index) => id !== confirmedAnnotationDeletionIds[index])
          ) {
            emittedConfirmedDeletionIdsRef.current = confirmedAnnotationDeletionIds;
            annotationEditingRef.current?.onConfirmedAnnotationDeletionIdsChange(
              confirmedAnnotationDeletionIds,
            );
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
    void crepe
      .create()
      .then(async () => {
        created = true;
        if (disposed) {
          await crepe.destroy();
          return;
        }
        onEditorRootChangeRef.current?.(rootRef.current);
        setInitializationState("ready");
      })
      .catch(() => {
        if (!disposed) setInitializationState("failed");
      });
    return () => {
      disposed = true;
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      retryImageUploadRef.current = null;
      failedImageFiles.clear();
      onUploadStateChangeRef.current?.(false);
      onEditorRootChangeRef.current?.(null);
      guardRef.current?.discard();
      guardRef.current = null;
      if (created) void crepe.destroy();
    };
  }, [allowImageUploads, compact]);

  return (
    <>
      <div className={`markdown-editor-host${compact ? " markdown-editor-host--compact" : ""}`}>
        <div
          ref={rootRef}
          className={compact ? "markdown-editor markdown-editor--compact" : "markdown-editor"}
          aria-busy={
            initializationState === "loading" ||
            imageUploadTasks.some((task) => task.status === "uploading")
          }
          aria-disabled={disabled}
        />
        {initializationState === "loading" && (
          <div
            className={`markdown-editor-loading editor-initializing-state${compact ? " markdown-editor-loading--compact" : ""}`}
            role="status"
          >
            <span>{compact ? "正在加载编辑器…" : "正在加载正文…"}</span>
          </div>
        )}
        {initializationState === "failed" && (
          <div className="editor-load-state editor-initialization-failed" role="alert">
            <span>正文编辑器加载失败，帖子内容没有丢失。</span>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => window.location.reload()}
            >
              重试
            </button>
          </div>
        )}
      </div>
      {imageUploadTasks.length > 0 && (
        <div
          className="asset-upload-list asset-upload-list--editor"
          aria-label="图片上传状态"
          aria-live="polite"
        >
          {imageUploadTasks.map((task) => (
            <div className="asset-upload-task" key={task.id}>
              <div>
                <strong>{task.filename}</strong>
                {task.status === "uploading" ? (
                  <>
                    <span>上传中 · {task.percent}%</span>
                    <progress
                      max={100}
                      value={task.percent}
                      aria-label={`${task.filename} 上传进度`}
                    />
                  </>
                ) : (
                  <span className="form-error" role="alert">
                    上传失败 · {task.error}
                  </span>
                )}
              </div>
              {task.status === "failed" && (
                <span className="asset-row-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void retryImageUploadRef.current?.(task.id)}
                    disabled={disabled}
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    className="text-button text-button--danger"
                    onClick={() => {
                      failedImageFilesRef.current.delete(task.id);
                      setImageUploadTasks((current) =>
                        current.filter((item) => item.id !== task.id),
                      );
                    }}
                  >
                    移除
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
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
          if (
            result?.kind === "STALE" ||
            result?.kind === "REENTER_COMPOSITION" ||
            result?.kind === "CLIPBOARD_ERROR"
          ) {
            setGuardMessage(result.message);
          } else {
            setGuardMessage(null);
          }
        }}
      />
      {guardMessage && !pendingImpact && (
        <p className="annotation-guard-status" role="status">
          {guardMessage}
        </p>
      )}
    </>
  );
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
