"use client";

import { Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type BoundaryProps = {
  children: ReactNode;
  title: string;
  description: string;
  onRetry: () => void;
};

class RegionBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => {
    this.setState({ failed: false });
    this.props.onRetry();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="region-error" role="alert">
      <strong>{this.props.title}</strong>
      <p>{this.props.description}</p>
      <button className="button button--ghost button--small" type="button" onClick={this.retry}>重试</button>
    </div>;
  }
}

export function RegionErrorBoundary({ children, title, description }: Omit<BoundaryProps, "onRetry">) {
  const router = useRouter();
  return <RegionBoundary title={title} description={description} onRetry={() => router.refresh()}>{children}</RegionBoundary>;
}
