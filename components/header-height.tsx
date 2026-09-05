"use client";
import { useEffect } from "react";

// One measured offset also accommodates text zoom and wrapped header controls.
export function HeaderHeight() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".site-header");
    if (!header) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--header-height",
        `${header.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--header-height");
    };
  }, []);
  return null;
}
