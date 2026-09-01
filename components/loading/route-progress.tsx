"use client";

import * as NextTopLoaderModule from "nextjs-toploader";

const topLoaderExport = NextTopLoaderModule.default as unknown;
const NextTopLoader = (
  typeof topLoaderExport === "function"
    ? topLoaderExport
    : (topLoaderExport as { default?: unknown }).default
) as typeof import("nextjs-toploader").default;

export function RouteProgress() {
  return (
    <NextTopLoader
      color="var(--green)"
      height={2}
      showSpinner={false}
      shadow={false}
      showForHashAnchor={false}
      zIndex={700}
    />
  );
}
