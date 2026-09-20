import {
  HAOJIE_ENGINE_VERSION,
  type MutationInput,
  type RoomMutation,
  type RoomSnapshot,
} from "./contracts.ts";
import type { CommandReceipt } from "../../vendor/haojie2/src/ui/online/types";

export type GameApiError = { code: string; message: string; incidentId?: string };
export type RoomClientState = {
  snapshot: RoomSnapshot;
  connection: "connecting" | "connected" | "disconnected";
  pending: boolean;
  error: GameApiError | null;
  fatal: boolean;
};
type Pending = { path: string; body: string; resolve: (receipt: CommandReceipt) => void };
type JsonReply = RoomMutation & { error?: GameApiError; snapshot?: RoomSnapshot };

export async function roomFetch(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)])
    : AbortSignal.timeout(12000);
  const response = await fetcher(url, {
    ...init,
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = response.status === 204 ? null : ((await response.json()) as JsonReply);
  return { response, body };
}

export function acceptRoomSnapshot(
  current: RoomSnapshot,
  incoming: RoomSnapshot,
  force = false,
): RoomSnapshot {
  if (
    !incoming?.room ||
    incoming.room.id !== current.room.id ||
    !Number.isSafeInteger(incoming.room.revision)
  )
    throw new Error("INVALID_ROOM_RESPONSE");
  if (incoming.room.revision < current.room.revision) return current;
  if (incoming.room.revision === current.room.revision && !force) return current;
  if (incoming.update) {
    if (
      incoming.update.matchId !== incoming.room.id ||
      incoming.update.revision !== incoming.room.revision
    )
      throw new Error("INVALID_ROOM_RESPONSE");
    return {
      ...incoming,
      update: {
        ...incoming.update,
        kind:
          force ||
          incoming.update.kind === "snapshot" ||
          incoming.room.revision !== current.room.revision + 1
            ? "snapshot"
            : "update",
      },
    };
  }
  return incoming;
}

/** One room owns one polling loop and, at most, one command awaiting its own receipt. */
export class RoomClient {
  private state: RoomClientState;
  private listeners = new Set<() => void>();
  private running = false;
  private visible = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollAbort: AbortController | null = null;
  private writeAbort: AbortController | null = null;
  private pending: Pending | null = null;
  private uncertain = false;
  private failures = 0;
  private refreshAfterPoll = false;
  private endpoint: string;
  private fetcher: typeof fetch;

  constructor(initial: RoomSnapshot, fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
    this.state = {
      snapshot: initial,
      connection: "connecting",
      pending: false,
      error: null,
      fatal: false,
    };
    this.endpoint = `/api/haojie/rooms/${initial.room.id}`;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<RoomClientState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private accept(snapshot: RoomSnapshot, force = false) {
    const oldViewer = this.state.snapshot.room.viewer;
    if (oldViewer && snapshot.room.viewer !== oldViewer) throw new Error("ROOM_SEAT_CHANGED");
    this.publish({ snapshot: acceptRoomSnapshot(this.state.snapshot, snapshot, force) });
  }
  start() {
    this.running = true;
    this.refresh();
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.pollAbort?.abort();
    this.writeAbort?.abort();
    this.pending?.resolve({ ok: false, message: "页面已关闭。" });
    this.pending = null;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (visible) this.refresh();
  }
  refresh = () => {
    if (!this.running || this.state.fatal) return;
    clearTimeout(this.timer);
    if (this.pending && !this.writeAbort) void this.sendPending();
    if (this.pollAbort) {
      this.refreshAfterPoll = true;
      return;
    }
    this.failures = 0;
    void this.poll(true);
  };
  private terminal(error: GameApiError) {
    this.publish({ connection: "disconnected", error, fatal: true });
    clearTimeout(this.timer);
  }
  private async poll(force = false) {
    if (!this.running || this.pollAbort || this.state.fatal) return;
    const abort = new AbortController();
    this.pollAbort = abort;
    const full = force || this.state.connection !== "connected";
    const after = full ? "" : `?after=${this.state.snapshot.room.revision}`;
    let failure: GameApiError | null = null;
    try {
      const { response, body } = await roomFetch(
        this.endpoint + after,
        { signal: abort.signal },
        this.fetcher,
      );
      if (!this.running || abort.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          this.terminal(body?.error ?? { code: "ROOM_UNAVAILABLE", message: "房间无法访问。" });
          return;
        }
        failure = body?.error ?? null;
        throw new Error("POLL_FAILED");
      }
      if (body) this.accept(body, full);
      const recovering = full || this.failures > 0;
      this.failures = 0;
      this.publish({
        connection: this.uncertain ? "connecting" : "connected",
        error: this.uncertain || !recovering ? this.state.error : null,
      });
    } catch {
      if (!this.running || abort.signal.aborted) return;
      this.failures++;
      this.publish({
        connection: this.failures >= 4 ? "disconnected" : "connecting",
        error: failure ?? { code: "CONNECTION_LOST", message: "连接中断，正在恢复局面。" },
      });
    } finally {
      if (this.pollAbort === abort) this.pollAbort = null;
      if (this.running && !this.state.fatal) {
        const again = this.refreshAfterPoll;
        this.refreshAfterPoll = false;
        const active = ["waiting", "playing"].includes(this.state.snapshot.room.status);
        if (again || (active && this.failures < 4))
          this.timer = setTimeout(
            () => void this.poll(again),
            again
              ? 0
              : this.failures
                ? Math.min(8000, 1000 * 2 ** (this.failures - 1))
                : this.visible
                  ? 1000
                  : 10000,
          );
      }
    }
  }
  submit(
    input: Omit<MutationInput, "requestId" | "engineVersion"> & { command?: unknown },
  ): Promise<CommandReceipt> {
    if (this.pending || this.state.fatal || this.state.connection !== "connected")
      return Promise.resolve({ ok: false, message: "请等待局面同步后再操作。" });
    const path = input.kind === "command" ? "commands" : input.kind === "join" ? "join" : "finish";
    const { kind, ...fields } = input;
    const body = JSON.stringify({
      ...fields,
      ...(path === "finish" ? { kind } : {}),
      requestId: crypto.randomUUID(),
      engineVersion: HAOJIE_ENGINE_VERSION,
    });
    this.publish({ pending: true, error: null });
    return new Promise((resolve) => {
      this.pending = { path, body, resolve };
      void this.sendPending();
    });
  }
  private async sendPending() {
    if (!this.pending || this.writeAbort || !this.running || this.state.fatal) return;
    const pending = this.pending;
    const abort = new AbortController();
    this.writeAbort = abort;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const { response, body } = await roomFetch(
            `${this.endpoint}/${pending.path}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: pending.body,
              signal: abort.signal,
            },
            this.fetcher,
          );
          if (!this.running || abort.signal.aborted) return;
          if (response.ok) {
            if (
              !body?.receipt?.ok ||
              !Number.isSafeInteger(body.receipt.revision) ||
              body.room.revision < body.receipt.revision
            )
              throw new Error("INVALID_RECEIPT");
            this.accept(body, this.uncertain);
            this.pending = null;
            this.uncertain = false;
            this.publish({ pending: false, connection: "connected", error: null });
            pending.resolve(body.receipt);
            return;
          }
          if (response.status < 500 && response.status !== 429) {
            if (body?.snapshot) this.accept(body.snapshot, true);
            const error = body?.error ?? {
              code: "REQUEST_REJECTED",
              message: "操作未能完成，请同步后重试。",
            };
            this.pending = null;
            this.uncertain = false;
            this.publish({ pending: false, error, connection: "connected" });
            if ([401, 403, 404].includes(response.status) || error.code === "ENGINE_MISMATCH")
              this.terminal(error);
            pending.resolve({ ok: false, message: error.message });
            return;
          }
          this.publish({
            error: body?.error ?? {
              code: "SERVER_FAILURE",
              message: "操作结果尚未确认，正在重新连接。",
            },
          });
        } catch {
          if (!this.running || abort.signal.aborted) return;
          this.publish({
            error: { code: "RESULT_UNCERTAIN", message: "操作结果尚未确认，正在重新连接。" },
          });
        }
        this.uncertain = true;
        this.publish({ connection: attempt === 4 ? "disconnected" : "connecting" });
        if (attempt < 4)
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              abort.signal.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(
              finish,
              Math.min(8000, 1000 * 2 ** attempt) + Math.random() * 200,
            );
            abort.signal.addEventListener("abort", finish, { once: true });
          });
        if (!this.running || abort.signal.aborted) return;
      }
    } finally {
      if (this.writeAbort === abort) this.writeAbort = null;
    }
  }
}
