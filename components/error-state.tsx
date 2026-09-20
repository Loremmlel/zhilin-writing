"use client";

import { useEffect, useState } from "react";
import { reportClientError } from "@/lib/client-errors";

export function ErrorState({
  title,
  description,
  incidentId,
  error,
  reset,
}: {
  title: string;
  description: string;
  incidentId?: string;
  error?: Error;
  reset: () => void;
}) {
  const [clientIncidentId, setClientIncidentId] = useState<string>();
  useEffect(() => {
    if (!error) return;
    const id = reportClientError(error, "react");
    const timer = window.setTimeout(() => setClientIncidentId(id), 0);
    return () => window.clearTimeout(timer);
  }, [error]);
  const reference = incidentId ?? clientIncidentId;
  return (
    <section className="route-error-page" role="alert">
      <div className="quiet-card route-error-card">
        <span className="eyebrow">暂时遇到问题</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {reference && (
          <span className="incident-reference">
            错误编号：<code>{reference}</code>
          </span>
        )}
        <div className="route-error-actions">
          <button className="button button--primary" type="button" onClick={reset}>
            重新加载
          </button>
          {/* A full document navigation must remain available even when the app router failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="button button--ghost" href="/">
            返回首页
          </a>
        </div>
      </div>
    </section>
  );
}
