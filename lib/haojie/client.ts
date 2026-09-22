import {
  HAOJIE_ENGINE_VERSION,
  type RoomClientInput,
  type RoomMutation,
  type RoomSnapshot,
} from "./contracts.ts";
import type { CommandReceipt } from "../../vendor/haojie2/src/ui/online/types";
import {
  REACTION_BATCH_SIZE,
  REACTION_RELEASE_MS,
  type HaojieEmoji,
  type ReactionInput,
  type RoomReaction,
  type RoomReactions,
} from "./reactions.ts";

export type GameApiError = { code: string; message: string; incidentId?: string };
export type RoomClientState = {
  snapshot: RoomSnapshot;
  connection: "connecting" | "connected" | "disconnected";
  pending: boolean;
  error: GameApiError | null;
  fatal: boolean;
  reactions: RoomReaction[];
  reactionPending: number;
  reactionError: GameApiError | null;
};
type Pending = { path: string; body: string; resolve: (receipt: CommandReceipt) => void };
type JsonReply = RoomMutation & { error?: GameApiError; snapshot?: RoomSnapshot };

export async function roomFetch<T = JsonReply>(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  timeoutMs = 12000,
) {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, {
    ...init,
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = response.status === 204 ? null : ((await response.json()) as T);
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
  private lastContactAt = Date.now();
  private contactVersion = 0;
  private offline = false;
  private refreshAfterPoll = false;
  private endpoint: string;
  private fetcher: typeof fetch;
  private reactionSequence: number;
  private outgoingReactions: ReactionInput[] = [];
  private reactionQueue: RoomReaction[] = [];
  private reactionAbort: AbortController | null = null;
  private reactionSendTimer: ReturnType<typeof setTimeout> | undefined;
  private reactionPlayTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(initial: RoomSnapshot, fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
    this.reactionSequence = initial.reactions?.sequence ?? 0;
    this.state = {
      snapshot: initial,
      connection: "connecting",
      pending: false,
      error: null,
      fatal: false,
      reactions: [],
      reactionPending: 0,
      reactionError: null,
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
    this.acceptReactions(snapshot.reactions);
    if (this.state.snapshot.room.status !== "playing" && this.outgoingReactions.length) {
      this.outgoingReactions = [];
      this.publish({ reactionPending: 0 });
    }
  }
  private acceptReactions(reactions?: RoomReactions) {
    if (!reactions || reactions.sequence <= this.reactionSequence) return;
    if (this.visible)
      this.reactionQueue.push(
        ...reactions.items.filter((item) => item.sequence > this.reactionSequence),
      );
    this.reactionSequence = reactions.sequence;
    if (!this.reactionPlayTimer) this.playReaction();
  }
  private playReaction = () => {
    this.reactionPlayTimer = undefined;
    if (!this.running || !this.visible) return;
    const item = this.reactionQueue.shift();
    if (!item) return;
    this.publish({ reactions: [...this.state.reactions.slice(-31), item] });
    this.reactionPlayTimer = setTimeout(this.playReaction, REACTION_RELEASE_MS);
  };
  sendReaction = (emoji: HaojieEmoji) => {
    if (
      !this.running ||
      this.state.fatal ||
      !this.state.snapshot.room.viewer ||
      this.state.snapshot.room.status !== "playing"
    )
      return;
    this.outgoingReactions.push({ id: crypto.randomUUID(), emoji });
    this.publish({ reactionPending: this.outgoingReactions.length });
    if (!this.reactionAbort && !this.reactionSendTimer && !this.state.reactionError)
      this.reactionSendTimer = setTimeout(() => void this.flushReactions(), 120);
  };
  retryReactions = () => {
    if (!this.running || this.state.fatal || this.reactionAbort) return;
    clearTimeout(this.reactionSendTimer);
    this.publish({ reactionError: null });
    void this.flushReactions();
  };
  private async flushReactions() {
    this.reactionSendTimer = undefined;
    if (!this.running || this.state.fatal || this.reactionAbort || !this.outgoingReactions.length)
      return;
    const items = this.outgoingReactions.slice(0, REACTION_BATCH_SIZE);
    const abort = new AbortController();
    this.reactionAbort = abort;
    try {
      const { response, body } = await roomFetch<{
        reactions?: RoomReactions;
        error?: GameApiError;
      }>(
        `${this.endpoint}/reactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          signal: abort.signal,
        },
        this.fetcher,
      );
      if (!this.running || abort.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 404, 409].includes(response.status)) this.outgoingReactions = [];
        this.publish({
          reactionPending: this.outgoingReactions.length,
          reactionError: body?.error ?? {
            code: "REACTION_FAILED",
            message: "表情发送失败，请重试。",
          },
        });
        return;
      }
      if (!body?.reactions) throw new Error("INVALID_REACTION_RESPONSE");
      this.acceptReactions(body.reactions);
      this.outgoingReactions.splice(0, items.length);
      this.publish({ reactionPending: this.outgoingReactions.length, reactionError: null });
    } catch {
      if (this.running && !abort.signal.aborted)
        this.publish({
          reactionError: { code: "REACTION_UNCERTAIN", message: "表情发送暂未确认，可以重试。" },
        });
    } finally {
      if (this.reactionAbort === abort) this.reactionAbort = null;
      if (this.running && this.outgoingReactions.length && !this.state.reactionError)
        this.reactionSendTimer = setTimeout(() => void this.flushReactions(), 1000);
    }
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
    this.reactionAbort?.abort();
    clearTimeout(this.reactionSendTimer);
    clearTimeout(this.reactionPlayTimer);
    this.reactionSendTimer = undefined;
    this.reactionPlayTimer = undefined;
    this.reactionQueue = [];
    this.outgoingReactions = [];
    this.pending?.resolve({ ok: false, message: "页面已关闭。" });
    this.pending = null;
  }
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) this.reactionQueue = [];
    if (visible) this.refresh();
  }
  setOnline(online: boolean) {
    this.offline = !online;
    if (!this.running || this.state.fatal) return;
    if (online) {
      this.refresh();
      return;
    }
    clearTimeout(this.timer);
    this.pollAbort?.abort();
    this.writeAbort?.abort();
    if (this.pending) this.uncertain = true;
    this.publish({
      connection: "disconnected",
      error: { code: "OFFLINE", message: "网络已断开，联网后会自动恢复。" },
    });
  }
  refresh = () => {
    if (!this.running || this.state.fatal || this.offline) return;
    clearTimeout(this.timer);
    if (this.pending && !this.writeAbort) void this.sendPending();
    if (this.pollAbort) {
      this.refreshAfterPoll = true;
      return;
    }
    void this.poll(true);
  };
  private contacted() {
    this.lastContactAt = Date.now();
    this.contactVersion++;
    this.failures = 0;
  }
  private terminal(error: GameApiError) {
    this.publish({ connection: "disconnected", error, fatal: true });
    clearTimeout(this.timer);
  }
  private async poll(force = false) {
    if (!this.running || this.pollAbort || this.state.fatal || this.offline) return;
    const abort = new AbortController();
    this.pollAbort = abort;
    const contactVersion = this.contactVersion;
    const full = force || this.state.connection !== "connected";
    const after = `?afterReaction=${this.reactionSequence}${full ? "" : `&after=${this.state.snapshot.room.revision}`}`;
    let failure: GameApiError | null = null;
    try {
      const { response, body } = await roomFetch(
        this.endpoint + after,
        { signal: abort.signal },
        this.fetcher,
        4000,
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
      this.contacted();
      this.publish({
        connection: this.uncertain ? "connecting" : "connected",
        error: this.uncertain || !recovering ? this.state.error : null,
      });
      if (this.pending && !this.writeAbort) void this.sendPending();
    } catch {
      if (!this.running || abort.signal.aborted) return;
      // A command receipt received since this read began is newer evidence of connectivity.
      if (contactVersion !== this.contactVersion) return;
      this.failures++;
      if (
        this.state.connection !== "connected" ||
        (this.failures >= 2 && Date.now() - this.lastContactAt >= 4000)
      )
        this.publish({
          connection: this.failures >= 4 ? "disconnected" : "connecting",
          error: this.uncertain
            ? this.state.error
            : (failure ?? { code: "CONNECTION_LOST", message: "网络暂时不稳定，正在自动重连。" }),
        });
    } finally {
      if (this.pollAbort === abort) this.pollAbort = null;
      if (this.running && !this.state.fatal && !this.offline) {
        const again = this.refreshAfterPoll;
        this.refreshAfterPoll = false;
        const active = ["waiting", "playing"].includes(this.state.snapshot.room.status);
        if (again || active)
          this.timer = setTimeout(
            () => void this.poll(again),
            again
              ? 0
              : !this.visible
                ? 10000
                : this.failures && this.state.connection !== "connected"
                  ? Math.min(8000, 500 * 2 ** Math.min(this.failures - 1, 4))
                  : 500,
          );
      }
    }
  }
  submit(input: RoomClientInput): Promise<CommandReceipt> {
    if (this.pending || this.state.fatal || this.state.connection !== "connected")
      return Promise.resolve({ ok: false, message: "请等待局面同步后再操作。" });
    const path =
      input.kind === "command"
        ? "commands"
        : input.kind === "join"
          ? "join"
          : input.kind.startsWith("undo-")
            ? "undo"
            : "finish";
    const { kind, ...fields } = input;
    const body = JSON.stringify({
      ...fields,
      ...(path === "finish" || path === "undo" ? { kind } : {}),
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
    if (!this.pending || this.writeAbort || !this.running || this.state.fatal || this.offline)
      return;
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
            this.contacted();
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
            this.contacted();
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
