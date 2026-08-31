"use client";

import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { useEffect, useRef, useState } from "react";

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
};

async function uploadImage(file: File, onAssetUploaded?: (asset: UploadedAsset) => void) {
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch("/api/assets", { method: "POST", body: formData });
  const data = await response.json() as { error?: string; asset?: UploadedAsset; markdown?: string };
  if (!response.ok || !data.asset) throw new Error(data.error ?? "图片上传失败");
  const asset = { ...data.asset, markdown: data.markdown ?? "" } as UploadedAsset;
  onAssetUploaded?.(asset);
  return asset.url;
}

function MarkdownEditorSession({ initialMarkdown, onMarkdownChange, onAssetUploaded, compact = false, allowImageUploads = true, annotationEditing }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(initialMarkdown);
  const onChangeRef = useRef(onMarkdownChange);
  const uploadRef = useRef(onAssetUploaded);
  const annotationEditingRef = useRef(annotationEditing);
  const guardRef = useRef<ReturnType<typeof createAnnotationGuardPlugin> | null>(null);
  const [pendingImpact, setPendingImpact] = useState<PendingAnnotationImpact | null>(null);
  const [guardMessage, setGuardMessage] = useState<string | null>(null);

  useEffect(() => { onChangeRef.current = onMarkdownChange; }, [onMarkdownChange]);
  useEffect(() => { uploadRef.current = onAssetUploaded; }, [onAssetUploaded]);
  useEffect(() => { annotationEditingRef.current = annotationEditing; }, [annotationEditing]);

  useEffect(() => {
    if (!rootRef.current) return;
    let disposed = false;
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
          onUpload: (file) => uploadImage(file, uploadRef.current),
          inlineOnUpload: (file) => uploadImage(file, uploadRef.current),
          blockOnUpload: (file) => uploadImage(file, uploadRef.current),
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
          annotationEditingRef.current?.onConfirmedAnnotationDeletionIdsChange(confirmedAnnotationDeletionIds);
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
      guardRef.current?.discard();
      guardRef.current = null;
      window.setTimeout(() => void crepe.destroy(), 0);
    };
  }, [allowImageUploads, compact]);

  return <>
    <div ref={rootRef} className={compact ? "markdown-editor markdown-editor--compact" : "markdown-editor"} />
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
