"use client";

import { ErrorState } from "@/components/error-state";
import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <ErrorState title="站点暂时无法显示" description="服务遇到了临时问题。请稍后重试；如果仍无法打开，可以先返回首页。" reset={reset} />
      </body>
    </html>
  );
}
