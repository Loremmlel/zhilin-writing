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
      description="刚才的内容没有成功载入。你可以重试，当前页面之外的数据不会因此改变。"
      incidentId={error.digest}
      reset={reset}
    />
  );
}
