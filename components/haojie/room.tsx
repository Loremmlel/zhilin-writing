"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HaojieOnlineGame } from "@/vendor/haojie2/src/ui/online/HaojieOnlineGame";
import {
  HAOJIE_ENGINE_VERSION,
  HAOJIE_PATH,
  roomModeLabel,
  roomStatusLabel,
  type RoomSnapshot,
} from "@/lib/haojie/contracts";
import { RoomClient } from "@/lib/haojie/client";
import { ModalDialog } from "../modal-dialog";
import { PageHeader } from "../page-header";

export function HaojieRoom({ initial }: { initial: RoomSnapshot }) {
  const [client] = useState(() => new RoomClient(initial));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [confirm, setConfirm] = useState(false);
  const [copyState, setCopyState] = useState("");
  const { room, update } = state.snapshot;
  useEffect(() => {
    client.start();
    const visibility = () => client.setVisible(document.visibilityState === "visible");
    visibility();
    window.addEventListener("online", client.refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("online", client.refresh);
      document.removeEventListener("visibilitychange", visibility);
      client.stop();
    };
  }, [client]);
  const compatible = room.engineVersion === HAOJIE_ENGINE_VERSION;
  const busy = state.pending || state.connection !== "connected" || !compatible || state.fatal;
  const ended = room.status === "finished" || room.status === "cancelled";
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
      <PageHeader
        title="浩劫 2"
        actions={
          <Link className="button button--ghost" href={HAOJIE_PATH}>
            返回房间列表
          </Link>
        }
      />
      <div className="haojie-room-bar">
        <div>
          <strong>
            {room.player1.name} <span className="muted">对</span>{" "}
            {room.player2?.name ?? "等待另一位玩家"}
          </strong>
          <p className="muted">
            {roomModeLabel(room.mode)} · {roomStatusLabel(room.status)}
            {room.viewer ? ` · 你是 ${room.viewer} 号玩家` : ""}
          </p>
        </div>
        <div className="haojie-room-actions">
          {room.status === "waiting" && room.viewer === 1 && (
            <button type="button" className="button button--ghost" onClick={copyInvite}>
              复制邀请链接
            </button>
          )}
          {!ended && room.viewer && (
            <button
              type="button"
              className="button button--danger-quiet"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              {finishLabel}
            </button>
          )}
        </div>
      </div>
      <div className="haojie-sync" aria-live="polite">
        {copyState && <p role="status">{copyState}</p>}
        {!state.fatal && !ended && (
          <p role="status">
            {state.connection === "connected"
              ? state.pending
                ? "正在确认操作…"
                : "局面已同步"
              : state.connection === "connecting"
                ? "正在同步局面…"
                : "连接已中断"}
          </p>
        )}
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
        {!compatible && (
          <p className="form-error" role="alert">
            这局使用不同版本，当前暂不能继续操作。
          </p>
        )}
        {(state.connection === "disconnected" || state.error) && !state.fatal && (
          <button type="button" className="button button--ghost" onClick={client.refresh}>
            重新连接
          </button>
        )}
        {state.fatal && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        )}
      </div>
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
        <HaojieOnlineGame
          update={update}
          connection={state.connection}
          disabled={ended || busy}
          onCommand={(command, context) =>
            client.submit({ kind: "command", command, baseRevision: context.baseRevision })
          }
        />
      )}
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
