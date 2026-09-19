"use client";

import { ErrorState } from "@/components/error-state";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="页面暂时无法显示"
      description="内容加载失败，请重试。"
      incidentId={error.digest}
      reset={reset}
    />
  );
}
