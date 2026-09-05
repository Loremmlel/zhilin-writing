import type { ReactNode } from "react";

export function PageHeader({
  title,
  count,
  actions,
  description,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  description?: string;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>
          {title}
          {count !== undefined && <span className="page-count">{count}</span>}
        </h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
