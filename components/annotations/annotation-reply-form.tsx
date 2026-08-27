"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { AnnotationReplyActionState } from "@/app/(site)/posts/[id]/actions";
import { MarkdownEditor } from "@/components/editor/markdown-editor";

export function AnnotationReplyForm({ action, initialSubmissionKey, label = "回复批注" }: {
  action: (state: AnnotationReplyActionState, formData: FormData) => Promise<AnnotationReplyActionState>;
  initialSubmissionKey: string;
  label?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [markdown, setMarkdown] = useState("");
  const [submissionKey, setSubmissionKey] = useState(initialSubmissionKey);
  const [resetRevision, setResetRevision] = useState(0);
  useEffect(() => {
    if (!state.annotationReplyId) return;
    setMarkdown("");
    setSubmissionKey(crypto.randomUUID());
    setResetRevision((value) => value + 1);
    router.refresh();
  }, [router, state.annotationReplyId]);
  return <form action={formAction} className="annotation-reply-form" noValidate>
    <input type="hidden" name="contentMarkdown" value={markdown} />
    <input type="hidden" name="submissionKey" value={submissionKey} />
    <MarkdownEditor initialMarkdown="" onMarkdownChange={setMarkdown} compact resetRevision={resetRevision} />
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <div className="annotation-reply-form-actions"><span className="muted">发布后不可编辑</span><button className="button button--primary button--small" disabled={pending || !markdown.trim()} aria-busy={pending}>{pending ? "发布中…" : label}</button></div>
  </form>;
}
