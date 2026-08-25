"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { MarkdownEditor } from "@/components/editor/markdown-editor";

export type ReplyActionState = { error?: string; ok?: boolean };
export type ReplyFormAction = (state: ReplyActionState, formData: FormData) => Promise<ReplyActionState>;

export function ReplyForm({ action, label = "写回复", compact = false }: { action: ReplyFormAction; label?: string; compact?: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [markdown, setMarkdown] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  useEffect(() => {
    if (!state.ok) return;
    const timer = window.setTimeout(() => {
      setMarkdown("");
      setEditorKey((value) => value + 1);
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router, state.ok]);
  return (
    <form action={formAction} className={compact ? "reply-form reply-form--nested" : "reply-form"}>
      <input type="hidden" name="markdown" value={markdown} />
      <MarkdownEditor key={editorKey} initialMarkdown="" onMarkdownChange={setMarkdown} compact />
      {state.error && <p className="form-error">{state.error}</p>}
      <div className="reply-form-actions">
        <span className="muted">回复发布后不能编辑</span>
        <button className="button button--small button--primary" disabled={pending || !markdown.trim()}>{pending ? "发布中…" : label}</button>
      </div>
    </form>
  );
}
