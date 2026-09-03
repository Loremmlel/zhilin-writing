"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { LazyMarkdownEditor } from "@/components/editor/lazy-markdown-editor";
import { isBlockingAccessError, type ActionAccessErrorCode } from "@/lib/actions/result";

export type ReplyActionState = { error?: string; code?: ActionAccessErrorCode; replyId?: string };
export type ReplyFormAction = (state: ReplyActionState, formData: FormData) => Promise<ReplyActionState>;

export function ReplyForm({ action, initialSubmissionKey, label = "写回复", compact = false }: { action: ReplyFormAction; initialSubmissionKey: string; label?: string; compact?: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [markdown, setMarkdown] = useState("");
  const [submissionKey, setSubmissionKey] = useState(initialSubmissionKey);
  const [editorKey, setEditorKey] = useState(0);
  const focusedEditorRef = useRef<HTMLElement | null>(null);
  const accessBlocked = isBlockingAccessError(state.code);
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
    <form action={formAction} className={compact ? "reply-form reply-form--nested" : "reply-form"} noValidate>
      <input type="hidden" name="markdown" value={markdown} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <LazyMarkdownEditor key={editorKey} initialMarkdown="" onMarkdownChange={setMarkdown} onEditorRootChange={(root) => {
        if (!root || focusedEditorRef.current === root) return;
        focusedEditorRef.current = root;
        window.requestAnimationFrame(() => root.querySelector<HTMLElement>(".ProseMirror")?.focus());
      }} compact disabled={pending || accessBlocked} />
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <div className="reply-form-actions">
        <span className="muted">回复发布后不能编辑</span>
        <button className="button button--small button--primary" disabled={pending || accessBlocked || !markdown.trim() || !submissionKey} aria-busy={pending}>{pending ? "发布中…" : label}</button>
      </div>
    </form>
  );
}
