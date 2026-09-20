"use client";

import { Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { reportClientError } from "@/lib/client-errors";

type BoundaryProps = {
  children: ReactNode;
  title: string;
  description: string;
  onRetry: () => void;
};

class RegionBoundary extends Component<BoundaryProps, { failed: boolean; incidentId?: string }> {
  state: { failed: boolean; incidentId?: string } = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.setState({ incidentId: reportClientError(error, "react") });
  }

  retry = () => {
    this.setState({ failed: false, incidentId: undefined });
    this.props.onRetry();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="region-error" role="alert">
        <strong>{this.props.title}</strong>
        <p>{this.props.description}</p>
        {this.state.incidentId && (
          <p className="incident-reference">
            错误编号：<code>{this.state.incidentId}</code>
          </p>
        )}
        <button className="button button--ghost button--small" type="button" onClick={this.retry}>
          重试
        </button>
      </div>
    );
  }
}

export function RegionErrorBoundary({
  children,
  title,
  description,
}: Omit<BoundaryProps, "onRetry">) {
  const router = useRouter();
  return (
    <RegionBoundary title={title} description={description} onRetry={() => router.refresh()}>
      {children}
    </RegionBoundary>
  );
}
