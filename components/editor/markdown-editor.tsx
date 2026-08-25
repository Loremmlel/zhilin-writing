"use client";

import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { useEffect, useRef } from "react";

import { editorSessionKey } from "@/lib/editor/lifecycle";

export type UploadedAsset = {
  id: string;
  filename: string;
  kind: "image" | "attachment";
  url: string;
  markdown: string;
};

type MarkdownEditorProps = {
  initialMarkdown: string;
  onMarkdownChange: (markdown: string) => void;
  onAssetUploaded?: (asset: UploadedAsset) => void;
  compact?: boolean;
  resetRevision?: number;
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

function MarkdownEditorSession({ initialMarkdown, onMarkdownChange, onAssetUploaded, compact = false }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(initialMarkdown);
  const onChangeRef = useRef(onMarkdownChange);
  const uploadRef = useRef(onAssetUploaded);

  useEffect(() => { onChangeRef.current = onMarkdownChange; }, [onMarkdownChange]);
  useEffect(() => { uploadRef.current = onAssetUploaded; }, [onAssetUploaded]);

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
        [CrepeFeature.ImageBlock]: !compact,
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
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previous) => {
        if (!disposed && markdown !== previous) onChangeRef.current(markdown);
      });
    });
    void crepe.create();
    return () => {
      disposed = true;
      window.setTimeout(() => void crepe.destroy(), 0);
    };
  }, [compact]);

  return <div ref={rootRef} className={compact ? "markdown-editor markdown-editor--compact" : "markdown-editor"} />;
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
