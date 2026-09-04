"use client";

export function ErrorState({
  title,
  description,
  incidentId,
  reset,
}: {
  title: string;
  description: string;
  incidentId?: string;
  reset: () => void;
}) {
  return (
    <section className="route-error-page" role="alert">
      <div className="quiet-card route-error-card">
        <span className="eyebrow">暂时遇到问题</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {incidentId && (
          <span className="incident-reference">
            错误编号：<code>{incidentId}</code>
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
