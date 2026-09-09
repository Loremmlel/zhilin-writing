import { MAX_BATCH, PERFORMANCE_ENDPOINT, milliseconds, performanceRoute } from "./shared";

export function installPerformanceProbe() {
  if (typeof window === "undefined" || !("PerformanceObserver" in window)) return;
  const browser = window as Window & { __zhilinPerformance?: boolean };
  if (browser.__zhilinPerformance) return;
  browser.__zhilinPerformance = true;
  const send = window.fetch.bind(window);
  const queue: Record<string, unknown>[] = [];
  let sending = false;
  const enqueue = (record: Record<string, unknown>) => {
    if (queue.length >= 120) queue.shift();
    queue.push({ ...record, observedAt: Date.now() });
  };
  const flush = () => {
    if (sending || !queue.length) return;
    const body = JSON.stringify(queue.splice(0, MAX_BATCH));
    sending = true;
    // Drop failed telemetry; retries would add load precisely when the network is slow.
    void send(PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    })
      .catch(() => {})
      .finally(() => {
        sending = false;
      });
  };
  const observe = (
    type: string,
    callback: (entry: PerformanceEntry) => void,
    durationThreshold?: number,
  ) => {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) callback(entry);
      }).observe({
        type,
        buffered: true,
        ...(durationThreshold ? { durationThreshold } : {}),
      } as PerformanceObserverInit);
    } catch {
      /* Older browsers may not implement an advertised entry type. */
    }
  };
  const resource = (raw: PerformanceEntry) => {
    const entry = raw as PerformanceResourceTiming;
    const url = new URL(entry.name, location.href);
    if (url.origin !== location.origin || url.pathname === PERFORMANCE_ENDPOINT) return;
    const timing = (name: string) => entry.serverTiming?.find((item) => item.name === name);
    const record: Record<string, unknown> = {
      kind: entry.entryType,
      route: performanceRoute(url.pathname),
      durationMs: milliseconds(entry.duration),
      dnsMs: milliseconds(entry.domainLookupEnd - entry.domainLookupStart),
      connectMs: milliseconds(entry.connectEnd - entry.connectStart),
      tlsMs:
        entry.secureConnectionStart > 0
          ? milliseconds(entry.connectEnd - entry.secureConnectionStart)
          : 0,
      ttfbMs: milliseconds(entry.responseStart - entry.requestStart),
      downloadMs: milliseconds(entry.responseEnd - entry.responseStart),
      transferBytes: entry.transferSize,
      status: entry.responseStatus,
      requestId: timing("request")?.description,
      serverMs: timing("app")?.duration,
      dbMs: timing("db")?.duration,
      dbCount: timing("dbcount")?.duration,
      r2Ms: timing("r2")?.duration,
      r2Count: timing("r2count")?.duration,
    };
    if (entry.entryType === "navigation") {
      const nav = entry as PerformanceNavigationTiming;
      record.domInteractiveMs = milliseconds(nav.domInteractive);
      record.domCompleteMs = milliseconds(nav.domComplete);
    }
    enqueue(record);
  };
  observe("resource", resource);
  observe("navigation", resource);
  observe("longtask", (entry) =>
    enqueue({
      kind: "longtask",
      route: performanceRoute(location.pathname),
      durationMs: milliseconds(entry.duration),
    }),
  );
  observe(
    "event",
    (raw) => {
      const entry = raw as PerformanceEventTiming & { interactionId?: number };
      if (!entry.interactionId) return;
      enqueue({
        kind: "interaction",
        route: performanceRoute(location.pathname),
        durationMs: milliseconds(entry.duration),
        inputDelayMs: milliseconds(entry.processingStart - entry.startTime),
        processingMs: milliseconds(entry.processingEnd - entry.processingStart),
        presentationMs: milliseconds(entry.startTime + entry.duration - entry.processingEnd),
      });
    },
    40,
  );
  // Resource Timing does not reliably report rejected fetches. Preserve the original response/body.
  window.fetch = async (input, init) => {
    const started = performance.now();
    try {
      return await send(input, init);
    } catch (error) {
      try {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.origin === location.origin && url.pathname !== PERFORMANCE_ENDPOINT)
          enqueue({
            kind: "fetch_error",
            route: performanceRoute(url.pathname),
            durationMs: milliseconds(performance.now() - started),
          });
      } catch {
        /* Diagnostics must preserve the original fetch rejection. */
      }
      throw error;
    }
  };
  window.setInterval(flush, 10_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}
