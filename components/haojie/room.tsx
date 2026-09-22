"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  HaojieOnlineGame,
  type HaojieOnlineGameProps,
} from "@/vendor/haojie2/src/ui/online/HaojieOnlineGame";
import {
  HAOJIE_ENGINE_VERSION,
  HAOJIE_PATH,
  roomModeLabel,
  roomStatusLabel,
  type RoomSnapshot,
} from "@/lib/haojie/contracts";
import { RoomClient } from "@/lib/haojie/client";
import type { SiteUser } from "@/db/schema";
import { AccountMenu } from "../account-menu";
import { RoomNotice } from "./room-notice";
import { ModalDialog } from "../modal-dialog";
import { HaojieEmojiPicker, HaojieReactions } from "./reactions";

const MemoizedHaojieGame = memo(HaojieOnlineGame);

export function HaojieRoom({
  initial,
  member,
  isAdmin,
  writingEnabled,
}: {
  initial: RoomSnapshot;
  member: SiteUser;
  isAdmin: boolean;
  writingEnabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const actionTrigger = useRef<HTMLButtonElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  useEffect(() => {
    const node = navigation.current;
    if (!node) return;
    const measure = () =>
      root.current?.style.setProperty(
        "--header-height",
        `${node.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!actionsOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !actions.current?.contains(event.target))
        setActionsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      // The emoji popover owns Escape while it is open.
      if (
        event.key !== "Escape" ||
        actions.current?.querySelector(":popover-open") ||
        document.querySelector('[data-modal-dialog="true"]')
      )
        return;
      setActionsOpen(false);
      actionTrigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [actionsOpen]);
  const [client] = useState(() => new RoomClient(initial));
  const onCommand = useCallback<HaojieOnlineGameProps["onCommand"]>(
    (command, context) =>
      client.submit({ kind: "command", command, baseRevision: context.baseRevision }),
    [client],
  );
  const onUndo = useCallback(() => {
    void client.submit({
      kind: "undo-request",
      baseRevision: client.getSnapshot().snapshot.room.revision,
    });
  }, [client]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [confirm, setConfirm] = useState(false);
  const [copyState, setCopyState] = useState<{
    message: string;
    success: boolean;
    receipt: number;
  } | null>(null);
  const { room, update, undo, canUndo } = state.snapshot;
  const undoPending = undo?.status === "pending";
  const requestedUndo = undo?.requester === room.viewer;
  useEffect(() => {
    client.start();
    const visibility = () => client.setVisible(document.visibilityState === "visible");
    const connectivity = () => client.setOnline(navigator.onLine);
    visibility();
    if (!navigator.onLine) connectivity();
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      document.removeEventListener("visibilitychange", visibility);
      client.stop();
    };
  }, [client]);
  const compatible = room.engineVersion === HAOJIE_ENGINE_VERSION;
  const busy = state.pending || state.connection !== "connected" || !compatible || state.fatal;
  const ended = room.status === "finished" || room.status === "cancelled";
  const loading = state.fatal || (!ended && busy);

  const winner =
    room.winner === 1 ? room.player1.name : room.winner === 2 ? room.player2?.name : null;
  const finishLabel = room.status === "waiting" ? "取消房间" : "认输";
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(
        new URL(`${HAOJIE_PATH}/${room.id}`, location.origin).href,
      );
      setCopyState({ message: "邀请链接已复制", success: true, receipt: Date.now() });
    } catch {
      setCopyState({
        message: "复制失败，可以复制浏览器地址栏中的链接。",
        success: false,
        receipt: Date.now(),
      });
    }
  }
  async function finish() {
    setConfirm(false);
    await client.submit({
      kind: room.status === "waiting" ? "cancel" : "resign",
      baseRevision: room.revision,
    });
  }
  function respondUndo(kind: "undo-accept" | "undo-reject" | "undo-cancel") {
    if (!undoPending || !undo || busy) return;
    void client.submit({ kind, undoId: undo.id, baseRevision: room.revision });
  }
  return (
    <div ref={root} className="haojie-room" data-workspace-expanded="true">
      <h1 className="sr-only">浩劫 2 对局</h1>
      <header ref={navigation} className="haojie-room-bar">
        <nav className="haojie-room-nav" aria-label="对局导航">
          <Link
            className="button button--text haojie-room-back"
            href={HAOJIE_PATH}
            aria-label="返回房间列表"
          >
            <span aria-hidden="true">←</span> 房间
          </Link>
          <details
            className="haojie-room-info"
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget)
              )
                event.currentTarget.open = false;
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="查看对局信息">
              <strong>
                {room.player1.name} <span className="muted">对</span>{" "}
                {room.player2?.name ?? "等待加入"}
              </strong>
              <span className="muted haojie-room-mode">
                {roomModeLabel(room.mode)}
                {room.viewer ? ` · 你是${room.viewer === 1 ? "苍穹方" : "赤焰方"}` : ""}
              </span>
            </summary>
            <div className="haojie-room-info-panel">
              <strong>
                {room.player1.name} 对 {room.player2?.name ?? "等待另一位玩家"}
              </strong>
              <p>
                {roomModeLabel(room.mode)}
                {room.viewer ? ` · 你是${room.viewer === 1 ? "苍穹方" : "赤焰方"}` : ""}
              </p>
            </div>
          </details>
          <div className="haojie-room-status" role="status">
            <span>
              {undoPending && !ended
                ? requestedUndo
                  ? "等待悔棋确认"
                  : "对方申请悔棋"
                : state.pending
                  ? "确认中…"
                  : roomStatusLabel(room.status)}
            </span>
            {undoPending && requestedUndo && !ended && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => respondUndo("undo-cancel")}
              >
                撤回
              </button>
            )}
          </div>
          <AccountMenu
            member={member}
            isAdmin={isAdmin}
            haojieEnabled
            writingEnabled={writingEnabled}
            compact
          />
        </nav>
      </header>
      <div className="haojie-room-notices">
        {copyState && (
          <RoomNotice key={copyState.receipt} transient={copyState.success}>
            {copyState.message}
          </RoomNotice>
        )}
        {undo && !undoPending && !ended && (
          <RoomNotice key={`${undo.id}:${undo.status}`} transient>
            {undo.status === "accepted"
              ? "双方已同意，已回退上一步。"
              : undo.status === "rejected"
                ? requestedUndo
                  ? "对方未同意悔棋。"
                  : "已拒绝悔棋。"
                : "悔棋请求已撤回。"}
          </RoomNotice>
        )}
        {state.reactionError && (
          <RoomNotice
            key={`reaction:${state.reactionError.incidentId ?? state.reactionError.message}`}
          >
            <p className="form-error">
              {state.reactionError.message}
              {state.reactionError.incidentId && (
                <>
                  {" "}
                  错误编号：<code>{state.reactionError.incidentId}</code>
                </>
              )}
            </p>
            {state.reactionPending > 0 && !ended && (
              <button type="button" className="text-button" onClick={client.retryReactions}>
                重试发送
              </button>
            )}
          </RoomNotice>
        )}
        {!loading && state.error && (
          <RoomNotice key={`operation:${state.error.incidentId ?? state.error.message}`}>
            <p className="form-error">
              {state.error.message}
              {state.error.incidentId && (
                <>
                  {" "}
                  错误编号：<code>{state.error.incidentId}</code>
                </>
              )}
            </p>
          </RoomNotice>
        )}
      </div>
      <div className="haojie-room-viewport page-column">
        <div className="haojie-room-content">
          {room.status === "waiting" && (
            <section className="empty-state haojie-waiting">
              <p>
                {room.viewer === 1
                  ? "把邀请链接发给另一位成员，即可开始对局。"
                  : `${room.player1.name} 邀请你进行一场${roomModeLabel(room.mode)}对局。`}
              </p>
              {!room.viewer && (
                <button
                  type="button"
                  className="button button--primary haojie-join"
                  disabled={busy}
                  aria-busy={state.pending}
                  onClick={() => void client.submit({ kind: "join", baseRevision: room.revision })}
                >
                  {state.pending ? "正在加入…" : "加入对局"}
                </button>
              )}
            </section>
          )}
          {ended && (
            <div className="haojie-result" role="status">
              <strong>
                {room.status === "cancelled"
                  ? "房间已取消"
                  : room.endReason === "aborted"
                    ? "管理员已结束本局"
                    : room.winner === "draw"
                      ? "本局平局"
                      : `${winner ?? "对手"} 获胜`}
              </strong>
              {room.endReason === "resign" && <span>本局以认输结束</span>}
              <Link className="button button--ghost" href={HAOJIE_PATH}>
                再开一局
              </Link>
            </div>
          )}
          {update && (
            <div className="haojie-game-stage" inert={loading}>
              <MemoizedHaojieGame
                update={update}
                connection={state.connection}
                disabled={ended || busy || undoPending}
                onCommand={onCommand}
                onUndo={onUndo}
                canUndo={canUndo && !undoPending}
              />
            </div>
          )}
        </div>
      </div>
      {!ended && room.viewer && (
        <div
          ref={actions}
          className="haojie-room-actions"
          data-open={actionsOpen}
          role="group"
          aria-label="对局操作"
        >
          <button
            ref={actionTrigger}
            type="button"
            className="button button--ghost haojie-actions-toggle"
            aria-expanded={actionsOpen}
            aria-controls="haojie-action-controls"
            onClick={() => setActionsOpen((open) => !open)}
          >
            对局操作
          </button>
          <div id="haojie-action-controls" className="haojie-action-controls">
            {room.status === "playing" && (
              <HaojieEmojiPicker
                disabled={state.fatal || state.connection !== "connected"}
                pending={state.reactionPending}
                onSend={client.sendReaction}
              />
            )}
            {room.status === "waiting" && room.viewer === 1 && (
              <button type="button" className="button button--ghost" onClick={copyInvite}>
                复制邀请链接
              </button>
            )}
            <button
              type="button"
              className="button button--danger-quiet"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              {finishLabel}
            </button>
          </div>
        </div>
      )}
      {loading && (
        <div
          className={`haojie-loading${state.pending && state.connection === "connected" && !state.fatal && compatible ? " haojie-loading--pending" : ""}`}
        >
          <div className="haojie-loading-panel">
            <div role={state.fatal || !compatible ? "alert" : "status"}>
              {!state.fatal && compatible && <span className="haojie-spinner" aria-hidden="true" />}
              <strong>
                {state.fatal
                  ? "对局暂不可用"
                  : !compatible
                    ? "版本不兼容"
                    : state.pending
                      ? "加载中，正在确认操作…"
                      : state.error
                        ? "加载中，正在恢复连接…"
                        : "加载中，正在同步局面…"}
              </strong>
              <p>
                {!compatible
                  ? "这局使用不同版本，当前暂不能继续操作。"
                  : (state.error?.message ??
                    (state.pending
                      ? "正在等待服务器确认，请稍候。"
                      : "正在获取最新局面，请稍候。"))}
              </p>
              {state.error?.incidentId && (
                <p>
                  错误编号：<code>{state.error.incidentId}</code>
                </p>
              )}
            </div>
            <div className="haojie-loading-actions">
              {state.fatal || !compatible ? (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => window.location.reload()}
                >
                  重新加载
                </button>
              ) : (
                <button type="button" className="button button--primary" onClick={client.refresh}>
                  立即重试
                </button>
              )}
              <Link className="button button--ghost" href={HAOJIE_PATH}>
                返回房间列表
              </Link>
            </div>
          </div>
        </div>
      )}
      <HaojieReactions items={state.reactions} viewer={room.viewer} />
      <ModalDialog
        open={undoPending && !requestedUndo && !ended && !loading && !confirm}
        title="对方申请悔棋"
        description="是否同意撤销最近一次操作，回到上一步？"
        onClose={() => respondUndo("undo-reject")}
        alert
      >
        {state.error && (
          <p className="form-error" role="alert">
            {state.error.message}
            {state.error.incidentId && (
              <>
                {" "}
                错误编号：<code>{state.error.incidentId}</code>
              </>
            )}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => respondUndo("undo-reject")}
          >
            拒绝
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => respondUndo("undo-accept")}
          >
            同意悔棋
          </button>
        </div>
      </ModalDialog>
      <ModalDialog
        open={confirm}
        title={`${finishLabel}？`}
        description={
          room.status === "waiting"
            ? "取消后，这个邀请链接将无法加入。"
            : "认输后对手获胜，这局将结束。"
        }
        onClose={() => setConfirm(false)}
        alert
      >
        <div className="dialog-actions">
          <button type="button" className="button button--ghost" onClick={() => setConfirm(false)}>
            继续保留
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={() => void finish()}
          >
            {finishLabel}
          </button>
        </div>
      </ModalDialog>
    </div>
  );
}
