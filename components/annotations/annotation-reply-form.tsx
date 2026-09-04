"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import type { AnnotationReplyActionState } from "@/app/(site)/posts/[id]/actions";
import { ActionErrorMessage } from "@/components/action-error-message";
import { LazyMarkdownEditor } from "@/components/editor/lazy-markdown-editor";
import { replyMarkdownAfterResult } from "@/lib/annotations/reply-composer";
import { isBlockingAccessError } from "@/lib/actions/result";

export function AnnotationReplyForm({
  action,
  initialSubmissionKey,
  label = "回复批注",
  focusRequest = 0,
  onSuccess,
}: {
  action: (
    state: AnnotationReplyActionState,
    formData: FormData,
  ) => Promise<AnnotationReplyActionState>;
  initialSubmissionKey: string;
  label?: string;
  focusRequest?: number;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const editorRootRef = useRef<HTMLElement | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const [state, formAction, pending] = useActionState(action, {});
  const [markdown, setMarkdown] = useState("");
  const [submissionKey, setSubmissionKey] = useState(initialSubmissionKey);
  const [resetRevision, setResetRevision] = useState(0);
  const annotationReplyId = state.annotationReplyId;
  const accessBlocked = isBlockingAccessError(state.code);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);
  useEffect(() => {
    if (focusRequest === 0) return;
    const frame = window.requestAnimationFrame(() =>
      editorRootRef.current?.querySelector<HTMLElement>(".ProseMirror")?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);
  useEffect(() => {
    if (!annotationReplyId) return;
    const timer = window.setTimeout(() => {
      setMarkdown((current) => replyMarkdownAfterResult(current, { annotationReplyId }));
      setSubmissionKey(crypto.randomUUID());
      setResetRevision((value) => value + 1);
      onSuccessRef.current?.();
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [annotationReplyId, router]);
  return (
    <form action={formAction} className="annotation-reply-form" noValidate>
      <input type="hidden" name="contentMarkdown" value={markdown} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <LazyMarkdownEditor
        initialMarkdown=""
        onMarkdownChange={setMarkdown}
        onEditorRootChange={(root) => {
          editorRootRef.current = root;
          if (root && focusRequest > 0)
            window.requestAnimationFrame(() =>
              root.querySelector<HTMLElement>(".ProseMirror")?.focus(),
            );
        }}
        compact
        resetRevision={resetRevision}
        disabled={pending || accessBlocked}
      />
      <ActionErrorMessage error={state.error} incidentId={state.incidentId} />
      <div className="annotation-reply-form-actions">
        <span className="muted">发布后不可编辑</span>
        <button
          className="button button--primary button--small"
          disabled={pending || accessBlocked || !markdown.trim()}
          aria-busy={pending}
        >
          {pending ? "发布中…" : label}
        </button>
      </div>
    </form>
  );
}
