"use client";

import { useEffect, useState, type ComponentType } from "react";

import type { MarkdownEditorProps } from "./markdown-editor";

export function LazyMarkdownEditor(props: MarkdownEditorProps) {
  const [Editor, setEditor] = useState<ComponentType<MarkdownEditorProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void import("./markdown-editor")
      .then((module) => {
        if (active) setEditor(() => module.MarkdownEditor);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (Editor) return <Editor {...props} />;
  if (failed)
    return (
      <div className="editor-load-state" role="alert">
        <span>编辑器加载失败，已保留当前页面。</span>
        <button
          className="button button--ghost button--small"
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          重试
        </button>
      </div>
    );
  return (
    <div
      className={`markdown-editor-loading${props.compact ? " markdown-editor-loading--compact" : ""}`}
      aria-busy="true"
    >
      <span className="sr-only">正在加载编辑器</span>
    </div>
  );
}
