"use client";

import NextTopLoader from "nextjs-toploader";

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
