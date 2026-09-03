"use client";

import { useEffect } from "react";

export function DeepLinkHighlighter({ targetId }: { targetId?: string }) {
  useEffect(() => {
    if (!targetId) return;
    let secondFrame = 0;
    let timeout = 0;
    const frame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        if (!target) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
        target.focus({ preventScroll: true });
        target.classList.add("is-deep-linked");
        timeout = window.setTimeout(() => target.classList.remove("is-deep-linked"), 2_000);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timeout);
      document.getElementById(targetId)?.classList.remove("is-deep-linked");
    };
  }, [targetId]);

  return null;
}
