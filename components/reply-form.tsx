"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { MarkdownEditor } from "@/components/editor/markdown-editor";

export type ReplyActionState = { error?: string; replyId?: string };
export type ReplyFormAction = (state: ReplyActionState, formData: FormData) => Promise<ReplyActionState>;

export function ReplyForm({ action, initialSubmissionKey, label = "写回复", compact = false }: { action: ReplyFormAction; initialSubmissionKey: string; label?: string; compact?: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [markdown, setMarkdown] = useState("");
  const [submissionKey, setSubmissionKey] = useState(initialSubmissionKey);
  const [editorKey, setEditorKey] = useState(0);
  useEffect(() => {
    if (!state.replyId) return;
    const timer = window.setTimeout(() => {
      setMarkdown("");
      setSubmissionKey(crypto.randomUUID());
      setEditorKey((value) => value + 1);
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router, state.replyId]);
  return (
    <form action={formAction} className={compact ? "reply-form reply-form--nested" : "reply-form"}>
      <input type="hidden" name="markdown" value={markdown} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <MarkdownEditor key={editorKey} initialMarkdown="" onMarkdownChange={setMarkdown} compact />
      {state.error && <p className="form-error">{state.error}</p>}
      <div className="reply-form-actions">
        <span className="muted">回复发布后不能编辑</span>
        <button className="button button--small button--primary" disabled={pending || !markdown.trim() || !submissionKey}>{pending ? "发布中…" : label}</button>
      </div>
    </form>
  );
}
