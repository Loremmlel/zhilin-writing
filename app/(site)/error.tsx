"use client";

import { ErrorState } from "@/components/error-state";

export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="这个区域暂时无法显示" description="请重试。如果登录状态已经失效，或账号已从白名单移除，请重新登录或联系管理员。" reset={reset} />;
}
