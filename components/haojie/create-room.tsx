"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PendingSubmitButton } from "../pending/pending-submit-button";
import { HAOJIE_PATH, type RoomMode } from "@/lib/haojie/contracts";
import { roomFetch, type GameApiError } from "@/lib/haojie/client";

export function CreateRoom() {
  const router = useRouter();
  const pending = useRef<{ requestId: string; mode: RoomMode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [mode, setMode] = useState<RoomMode>("classic");
  const [error, setError] = useState<GameApiError | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function create() {
    if (busy) return;
    pending.current ??= { requestId: crypto.randomUUID(), mode };
    setBusy(true);
    setError(null);
    try {
      const { response, body } = await roomFetch("/api/haojie/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.current),
      });
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) {
          pending.current = null;
          setUncertain(false);
        } else setUncertain(true);
        setError(body?.error ?? { code: "CREATE_FAILED", message: "未能创建房间，请重试。" });
        return;
      }
      if (!body?.room?.id) throw new Error("INVALID_ROOM_RESPONSE");
      router.push(`${HAOJIE_PATH}/${body.room.id}`);
    } catch {
      if (!mounted.current) return;
      setUncertain(true);
      setError({ code: "RESULT_UNCERTAIN", message: "尚未收到创建结果，请重试确认。" });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form action={create} noValidate className="haojie-create">
      <fieldset disabled={busy || uncertain}>
        <legend>对局模式</legend>
        <label>
          <input
            type="radio"
            name="mode"
            value="classic"
            checked={mode === "classic"}
            onChange={() => setMode("classic")}
          />
          经典
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            value="shrine"
            checked={mode === "shrine"}
            onChange={() => setMode("shrine")}
          />
          神龛
        </label>
      </fieldset>
      <PendingSubmitButton
        className="button button--primary"
        pendingLabel="创建中…"
        reserveLabels={["确认创建结果"]}
      >
        {uncertain ? "确认创建结果" : "创建房间"}
      </PendingSubmitButton>
      {error && (
        <p className="form-error" role="alert">
          {error.message}
          {error.incidentId && (
            <>
              {" "}
              错误编号：<code>{error.incidentId}</code>
            </>
          )}
        </p>
      )}
      {error && ["AUTH_EXPIRED", "ACCESS_REVOKED", "ONBOARDING_REQUIRED"].includes(error.code) && (
        <button
          type="button"
          className="button button--ghost"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      )}
    </form>
  );
}
