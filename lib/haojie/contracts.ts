import type { Command, Player } from "../../vendor/haojie2/src/engine/types";
import type { OnlineUpdate } from "../../vendor/haojie2/src/ui/online/types";
import type { RoomReactions } from "./reactions.ts";

export const HAOJIE_ENGINE_VERSION = "2a9768eebcdefde8bb53ee791a885ce4e54ca810";
export const HAOJIE_PATH = "/games/haojie";
export type RoomStatus = "waiting" | "playing" | "finished" | "cancelled";
export type RoomMode = "classic" | "shrine";
export type RoomSummary = {
  id: string;
  mode: RoomMode;
  status: RoomStatus;
  revision: number;
  player1: { id: string; name: string };
  player2: { id: string; name: string } | null;
  viewer: Player | null;
  winner: Player | "draw" | null;
  endReason: "game" | "resign" | "cancel" | "aborted" | null;
  updatedAt: number;
  engineVersion: string;
};
export type RoomSnapshot = {
  room: RoomSummary;
  update: OnlineUpdate | null;
  reactions?: RoomReactions;
  canUndo?: boolean;
  undo?: RoomUndo | null;
};
export type RoomUndo = {
  id: string;
  requester: Player;
  status: "pending" | "accepted" | "rejected" | "cancelled";
};
export type RoomMutation = RoomSnapshot & { receipt: { ok: true; revision: number } };
export type RoomClientInput = {
  baseRevision: number;
} & (
  | { kind: "join" }
  | { kind: "command"; command: Command }
  | { kind: "cancel" }
  | { kind: "resign" }
  | { kind: "undo-request" }
  | { kind: "undo-accept" | "undo-reject" | "undo-cancel"; undoId: string }
);
export type MutationInput = RoomClientInput & { requestId: string; engineVersion: string };
export const roomModeLabel = (mode: RoomMode) => (mode === "shrine" ? "神龛" : "经典");
export const roomStatusLabel = (status: RoomStatus) =>
  ({ waiting: "等待加入", playing: "对局中", finished: "已结束", cancelled: "已取消" })[status];

export class HaojieError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "HaojieError";
    this.code = code;
    this.status = status;
  }
}
