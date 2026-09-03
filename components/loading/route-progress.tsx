"use client";

import { useEffect, useState } from "react";
import {
  createRouteProgressController,
  type RouteProgressController,
  type RouteProgressSnapshot,
} from "@/lib/loading/route-progress";
import { ROUTE_PROGRESS_START_EVENT } from "@/lib/loading/route-progress-events";

type VinextNavigate = (...args: unknown[]) => Promise<unknown> | unknown;
type RouteProgressBridge = {
  originalNavigate: VinextNavigate;
  wrappedNavigate: VinextNavigate;
  originalFetch: typeof window.fetch;
  wrappedFetch: typeof window.fetch;
  controllers: Set<RouteProgressController>;
};

type BrowserWindow = Window & {
  __VINEXT_RSC_NAVIGATE__?: VinextNavigate;
  __ZHILIN_ROUTE_PROGRESS_BRIDGE__?: RouteProgressBridge;
};

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.headers) return new Headers(init.headers);
  if (typeof Request !== "undefined" && input instanceof Request) return input.headers;
  return new Headers();
}

function isRscRequest(input: RequestInfo | URL, init?: RequestInit) {
  return requestHeaders(input, init).get("RSC") === "1";
}

function isServerActionRequest(input: RequestInfo | URL, init?: RequestInit) {
  const headers = requestHeaders(input, init);
  const requestMethod =
    typeof Request !== "undefined" && input instanceof Request ? input.method : "GET";
  const method = (init?.method ?? requestMethod).toUpperCase();
  return method === "POST" && (headers.has("x-rsc-action") || headers.has("next-action"));
}

function installNavigationBridge(controller: RouteProgressController) {
  const browserWindow = window as BrowserWindow;
  const existing = browserWindow.__ZHILIN_ROUTE_PROGRESS_BRIDGE__;
  if (existing) {
    existing.controllers.add(controller);
    return () => existing.controllers.delete(controller);
  }

  const originalNavigate = browserWindow.__VINEXT_RSC_NAVIGATE__;
  if (typeof originalNavigate !== "function") return null;

  const originalFetch = browserWindow.fetch;
  const bridge: RouteProgressBridge = {
    originalNavigate,
    wrappedNavigate: originalNavigate,
    originalFetch,
    wrappedFetch: originalFetch,
    controllers: new Set([controller]),
  };

  const wrappedNavigate: VinextNavigate = async (...args) => {
    const tokens = [...bridge.controllers].map((item) => [item, item.start()] as const);
    try {
      return await originalNavigate(...args);
    } finally {
      for (const [item, token] of tokens) item.complete(token);
    }
  };

  const wrappedFetch: typeof window.fetch = async function (this: Window, input, init) {
    const isAction = isServerActionRequest(input, init);
    const tracksNavigation = isRscRequest(input, init) && !isAction;
    const tokens = isAction
      ? [...bridge.controllers].map((item) => [item, item.start()] as const)
      : [];
    try {
      const response = await originalFetch.call(this, input, init);
      if (tracksNavigation) for (const item of bridge.controllers) item.markResponse();
      if (isAction) for (const item of bridge.controllers) item.markResponse();
      return response;
    } finally {
      for (const [item, token] of tokens) item.complete(token);
    }
  };

  bridge.wrappedNavigate = wrappedNavigate;
  bridge.wrappedFetch = wrappedFetch;
  browserWindow.__VINEXT_RSC_NAVIGATE__ = wrappedNavigate;
  browserWindow.fetch = wrappedFetch;
  browserWindow.__ZHILIN_ROUTE_PROGRESS_BRIDGE__ = bridge;

  return () => {
    bridge.controllers.delete(controller);
    if (bridge.controllers.size > 0) return;
    if (browserWindow.__VINEXT_RSC_NAVIGATE__ === bridge.wrappedNavigate)
      browserWindow.__VINEXT_RSC_NAVIGATE__ = bridge.originalNavigate;
    if (browserWindow.fetch === bridge.wrappedFetch) browserWindow.fetch = bridge.originalFetch;
    if (browserWindow.__ZHILIN_ROUTE_PROGRESS_BRIDGE__ === bridge)
      delete browserWindow.__ZHILIN_ROUTE_PROGRESS_BRIDGE__;
  };
}

const initialSnapshot: RouteProgressSnapshot = { phase: "idle", progress: 0 };

export function RouteProgress() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    const controller = createRouteProgressController(setSnapshot);
    const start = () => controller.start();
    const reset = () => controller.reset();
    window.addEventListener(ROUTE_PROGRESS_START_EVENT, start);
    window.addEventListener("pagehide", reset);
    window.addEventListener("error", reset);
    window.addEventListener("unhandledrejection", reset);

    let removeBridge: (() => void) | null = null;
    const tryInstallBridge = () => {
      if (removeBridge) return true;
      const cleanup = installNavigationBridge(controller);
      if (!cleanup) return false;
      removeBridge = cleanup;
      return true;
    };
    const bridgeTimer = window.setInterval(() => {
      if (tryInstallBridge()) window.clearInterval(bridgeTimer);
    }, 50);
    tryInstallBridge();

    return () => {
      window.clearInterval(bridgeTimer);
      removeBridge?.();
      window.removeEventListener(ROUTE_PROGRESS_START_EVENT, start);
      window.removeEventListener("pagehide", reset);
      window.removeEventListener("error", reset);
      window.removeEventListener("unhandledrejection", reset);
      controller.dispose();
    };
  }, []);

  if (snapshot.phase === "idle") return null;

  return (
    <div id="route-progress" data-state={snapshot.phase} aria-hidden="true">
      <div className="route-progress__bar" style={{ transform: `scaleX(${snapshot.progress})` }} />
    </div>
  );
}
