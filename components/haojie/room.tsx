"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
import { ModalDialog } from "../modal-dialog";
import { HaojieEmojiPicker, HaojieReactions } from "./reactions";

const MemoizedHaojieGame = memo(HaojieOnlineGame);

export function HaojieRoom({ initial }: { initial: RoomSnapshot }) {
  const [client] = useState(() => new RoomClient(initial));
  const onCommand = useCallback<HaojieOnlineGameProps["onCommand"]>(
    (command, context) =>
      client.submit({ kind: "command", command, baseRevision: context.baseRevision }),
    [client],
  );
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [confirm, setConfirm] = useState(false);
  const [copyState, setCopyState] = useState("");
  const { room, update } = state.snapshot;
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
  const notice = state.reactionError || copyState || (!loading && state.error);
  const winner =
    room.winner === 1 ? room.player1.name : room.winner === 2 ? room.player2?.name : null;
  const finishLabel = room.status === "waiting" ? "取消房间" : "认输";
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(
        new URL(`${HAOJIE_PATH}/${room.id}`, location.origin).href,
      );
      setCopyState("邀请链接已复制");
    } catch {
      setCopyState("复制失败，可以复制浏览器地址栏中的链接。");
    }
  }
  async function finish() {
    setConfirm(false);
    await client.submit({
      kind: room.status === "waiting" ? "cancel" : "resign",
      baseRevision: room.revision,
    });
  }
  return (
    <div className="haojie-room page-column" data-workspace-expanded="true">
      <div className="haojie-room-viewport">
        <div className="haojie-room-content">
          <h1 className="sr-only">浩劫 2 对局</h1>
          <div className="haojie-room-bar">
            <Link className="button button--ghost" href={HAOJIE_PATH}>
              返回房间列表
            </Link>
            <div className="haojie-room-meta">
              <strong>
                {room.player1.name} <span className="muted">对</span>{" "}
                {room.player2?.name ?? "等待另一位玩家"}
              </strong>
              <span className="muted">
                {roomModeLabel(room.mode)}
                {room.viewer ? ` · 你是 ${room.viewer} 号玩家` : ""}
              </span>
            </div>
            <span className="muted" role="status">
              {state.pending ? "正在确认操作…" : roomStatusLabel(room.status)}
            </span>
          </div>
          {notice && (
            <div className="haojie-sync" aria-live="polite">
              {state.reactionError && (
                <p className="form-error" role="alert">
                  {state.reactionError.message}
                  {state.reactionError.incidentId && (
                    <>
                      {" "}
                      错误编号：<code>{state.reactionError.incidentId}</code>
                    </>
                  )}
                  {state.reactionPending > 0 && !ended && (
                    <button type="button" className="text-button" onClick={client.retryReactions}>
                      重试发送
                    </button>
                  )}
                </p>
              )}
              {copyState && <p role="status">{copyState}</p>}
              {!loading && state.error && (
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
            </div>
          )}
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
                disabled={ended || busy}
                onCommand={onCommand}
              />
            </div>
          )}
        </div>
      </div>
      {!ended && room.viewer && (
        <div className="haojie-room-actions" role="group" aria-label="对局操作">
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
