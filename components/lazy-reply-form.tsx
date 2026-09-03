"use client";

import { useState } from "react";

import type { ReplyFormAction } from "./reply-form";

type ReplyFormModule = typeof import("./reply-form");

export function LazyReplyForm({ action, initialSubmissionKey, label, openLabel = label, compact = false }: {
  action: ReplyFormAction;
  initialSubmissionKey: string;
  label: string;
  openLabel?: string;
  compact?: boolean;
}) {
  const [module, setModule] = useState<ReplyFormModule | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = async () => {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      setModule(await import("./reply-form"));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (module) return <module.ReplyForm action={action} initialSubmissionKey={initialSubmissionKey} label={label} compact={compact} />;
  return <div className={compact ? "inline-reply" : "reply-form-launcher"}>
    <button type="button" className={compact ? "text-button" : "button button--ghost"} onClick={() => void open()} disabled={loading} aria-busy={loading}>
      {loading ? "正在准备编辑器…" : openLabel}
    </button>
    {failed && <p className="form-error" role="alert">编辑器加载失败。请重试。</p>}
  </div>;
}
