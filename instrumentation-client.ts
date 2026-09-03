import { ROUTE_PROGRESS_START_EVENT } from "@/lib/loading/route-progress-events";

type NavigationType = "push" | "replace" | "traverse";

function isHashOnlyNavigation(href: string) {
  if (typeof window === "undefined") return false;

  try {
    const current = new URL(window.location.href);
    const next = new URL(href, current.href);
    return (
      current.origin === next.origin &&
      current.pathname === next.pathname &&
      current.search === next.search &&
      current.hash !== next.hash
    );
  } catch {
    return false;
  }
}

export function onRouterTransitionStart(href: string, navigationType: NavigationType) {
  if (typeof window === "undefined" || isHashOnlyNavigation(href)) return;
  window.dispatchEvent(
    new CustomEvent(ROUTE_PROGRESS_START_EVENT, {
      detail: { href, navigationType },
    }),
  );
}
