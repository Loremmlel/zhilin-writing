export type RouteProgressPhase = "idle" | "loading" | "complete";

export type RouteProgressSnapshot = {
  phase: RouteProgressPhase;
  progress: number;
};

export type RouteProgressListener = (snapshot: RouteProgressSnapshot) => void;

export type RouteProgressController = {
  start: () => number;
  markResponse: (token?: number) => boolean;
  complete: (token?: number) => boolean;
  reset: () => void;
  dispose: () => void;
};

export function createRouteProgressController(
  listener: RouteProgressListener,
  options: { completeDelayMs?: number; timeoutMs?: number } = {},
): RouteProgressController {
  const completeDelayMs = Math.max(0, options.completeDelayMs ?? 160);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 30_000);
  let activeToken: number | null = null;
  let sequence = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    if (watchdogTimer !== undefined) clearTimeout(watchdogTimer);
    settleTimer = undefined;
    watchdogTimer = undefined;
  }

  function emit(phase: RouteProgressPhase, progress: number) {
    listener({ phase, progress });
  }

  function reset() {
    clearTimers();
    activeToken = null;
    emit("idle", 0);
  }

  function start() {
    clearTimers();
    const token = ++sequence;
    activeToken = token;
    emit("loading", 0.08);
    watchdogTimer = setTimeout(() => {
      if (activeToken === token) reset();
    }, timeoutMs);
    return token;
  }

  function markResponse(token?: number) {
    if (activeToken === null || (token !== undefined && token !== activeToken)) return false;
    emit("loading", 0.72);
    return true;
  }

  function complete(token?: number) {
    if (activeToken === null || (token !== undefined && token !== activeToken)) return false;
    clearTimers();
    activeToken = null;
    emit("complete", 1);
    if (completeDelayMs === 0) emit("idle", 0);
    else settleTimer = setTimeout(() => emit("idle", 0), completeDelayMs);
    return true;
  }

  function dispose() {
    clearTimers();
    activeToken = null;
  }

  return {
    start,
    markResponse,
    complete,
    reset,
    dispose,
  };
}
