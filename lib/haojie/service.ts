import {
  applyPlayerCommand,
  canRebasePlayerCommand,
  createGame,
  getPlayerView,
  HAOJIE_RULESET,
  PLAYER_VIEW_VERSION,
  RuleError,
  type GameState,
} from "../../vendor/haojie2/src/engine/index";
import { pageBounds, PAGE_SIZE } from "../pagination.ts";
import {
  REACTION_LIMIT,
  REACTION_TTL_MS,
  type ReactionInput,
  type RoomReaction,
  type RoomReactions,
} from "./reactions.ts";
import {
  HAOJIE_ENGINE_VERSION,
  HaojieError,
  type MutationInput,
  type RoomMode,
  type RoomMutation,
  type RoomSnapshot,
  type RoomSummary,
} from "./contracts.ts";

type RoomRow = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  mode: RoomMode;
  status: RoomSummary["status"];
  revision: number;
  stateJson: string | null;
  reactionsJson: string;
  engineVersion: string;
  ruleset: string;
  viewVersion: number;
  lastChange: string;
  winner: "1" | "2" | "draw" | null;
  endReason: RoomSummary["endReason"];
  updatedAt: number;
};
type ReceiptRow = { requestHash: string; revision: number };
const ROOM_COLUMNS = `r.id, r.player1_id AS player1Id, p1.display_name AS player1Name,
  r.player2_id AS player2Id, p2.display_name AS player2Name, r.mode, r.status, r.revision,
  r.engine_version AS engineVersion, r.ruleset, r.view_version AS viewVersion,
  r.last_change AS lastChange, r.winner, r.end_reason AS endReason, r.updated_at AS updatedAt`;
const ROOM_JOINS = `FROM haojie_rooms r JOIN users p1 ON p1.id = r.player1_id
  LEFT JOIN users p2 ON p2.id = r.player2_id`;

function roomQuery(db: D1Database, id: string, actor: string, after = -1) {
  return db
    .prepare(
      `SELECT ${ROOM_COLUMNS}, r.reactions_json AS reactionsJson,
    CASE WHEN r.revision != ? AND (r.player1_id = ? OR r.player2_id = ?)
      THEN r.state_json ELSE NULL END AS stateJson
    ${ROOM_JOINS} WHERE r.id = ?
      AND (r.player1_id = ? OR r.player2_id = ? OR r.status = 'waiting')`,
    )
    .bind(after, actor, actor, id, actor, actor);
}

function summary(row: RoomRow, actor: string): RoomSummary {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    revision: row.revision,
    player1: { id: row.player1Id, name: row.player1Name },
    player2: row.player2Id ? { id: row.player2Id, name: row.player2Name ?? "对手" } : null,
    viewer: actor === row.player1Id ? 1 : actor === row.player2Id ? 2 : null,
    winner: row.winner === "draw" ? "draw" : row.winner === "1" ? 1 : row.winner === "2" ? 2 : null,
    endReason: row.endReason,
    updatedAt: row.updatedAt,
    engineVersion: row.engineVersion,
  };
}

function snapshot(row: RoomRow, actor: string, after = -1): RoomSnapshot {
  const room = summary(row, actor);
  const compatible =
    row.engineVersion === HAOJIE_ENGINE_VERSION &&
    row.ruleset === HAOJIE_RULESET &&
    row.viewVersion === PLAYER_VIEW_VERSION;
  return {
    room,
    reactions: room.viewer ? readReactions(row.reactionsJson) : { sequence: 0, items: [] },
    update:
      row.stateJson && room.viewer && compatible
        ? {
            matchId: row.id,
            revision: row.revision,
            kind:
              after >= 0 && row.revision === after + 1 && row.lastChange === "command"
                ? "update"
                : "snapshot",
            view: getPlayerView(JSON.parse(row.stateJson) as GameState, room.viewer),
          }
        : null,
  };
}

function requireRoom(row: RoomRow | null | undefined): RoomRow {
  if (!row) throw new HaojieError("ROOM_UNAVAILABLE", 404, "房间不存在或无法访问。");
  return row;
}

export async function getRoom(
  db: D1Database,
  id: string,
  actor: string,
  after = -1,
  afterReaction?: number,
) {
  const row = requireRoom(await roomQuery(db, id, actor, after).first<RoomRow>());
  const reactionsChanged =
    afterReaction !== undefined && readReactions(row.reactionsJson).sequence > afterReaction;
  return row.revision === after && !reactionsChanged ? null : snapshot(row, actor, after);
}

function readReactions(json: string): RoomReactions {
  const items = JSON.parse(json) as RoomReaction[];
  return {
    sequence: items.at(-1)?.sequence ?? 0,
    items: items.filter((item) => item.createdAt > Date.now() - REACTION_TTL_MS),
  };
}

export async function sendReactions(
  db: D1Database,
  id: string,
  actor: string,
  items: ReactionInput[],
): Promise<{ reactions: RoomReactions }> {
  const now = Date.now();
  // Bounded append and deduplication in one statement; game revision/state remain untouched.
  const updated = await db
    .prepare(
      `UPDATE haojie_rooms SET reactions_json = (
    SELECT json_group_array(json(value)) FROM (
      SELECT value, seq FROM (
        SELECT value, json_extract(value, '$.sequence') AS seq FROM json_each(reactions_json)
        UNION ALL
        SELECT json_object('id', json_extract(n.value, '$.id'),
          'sequence', COALESCE(json_extract(reactions_json, '$[#-1].sequence'), 0) + CAST(n.key AS INTEGER) + 1,
          'player', CASE WHEN player1_id = ? THEN 1 ELSE 2 END,
          'emoji', json_extract(n.value, '$.emoji'), 'createdAt', ?),
          COALESCE(json_extract(reactions_json, '$[#-1].sequence'), 0) + CAST(n.key AS INTEGER) + 1 AS seq
        FROM json_each(?) n
        WHERE NOT EXISTS (SELECT 1 FROM json_each(reactions_json) old
          WHERE json_extract(old.value, '$.id') = json_extract(n.value, '$.id'))
        ORDER BY seq DESC LIMIT ?
      ) ORDER BY seq ASC
    )
  ) WHERE id = ? AND status = 'playing' AND (player1_id = ? OR player2_id = ?)
    AND NOT EXISTS (SELECT 1 FROM json_each(reactions_json) old JOIN json_each(?) n
      ON json_extract(old.value, '$.id') = json_extract(n.value, '$.id')
      WHERE json_extract(old.value, '$.emoji') != json_extract(n.value, '$.emoji')
        OR json_extract(old.value, '$.player') != CASE WHEN player1_id = ? THEN 1 ELSE 2 END)
    RETURNING reactions_json AS reactionsJson`,
    )
    .bind(
      actor,
      now,
      JSON.stringify(items),
      REACTION_LIMIT,
      id,
      actor,
      actor,
      JSON.stringify(items),
      actor,
    )
    .first<{ reactionsJson: string }>();
  if (updated) return { reactions: readReactions(updated.reactionsJson) };
  const row = requireRoom(await roomQuery(db, id, actor, Number.MAX_SAFE_INTEGER).first<RoomRow>());
  const player = summary(row, actor).viewer;
  if (!player) throw new HaojieError("ROOM_FORBIDDEN", 403, "你不是这局的玩家。");
  if (row.status !== "playing")
    throw new HaojieError("ROOM_NOT_PLAYING", 409, "对局已结束，未发送的表情已取消。");
  throw new HaojieError("REQUEST_REUSED", 409, "这次表情请求已被使用，请重新选择。");
}

export async function listRooms(db: D1Database, actor: string, requestedPage = 1) {
  const filter = "(r.player1_id = ? OR r.player2_id = ?) AND r.status IN ('waiting', 'playing')";
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM haojie_rooms r WHERE ${filter}`)
    .bind(actor, actor)
    .first<{ total: number }>();
  const bounds = pageBounds(count?.total ?? 0, requestedPage);
  const rows = await db
    .prepare(
      `SELECT ${ROOM_COLUMNS} ${ROOM_JOINS} WHERE ${filter}
    ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(actor, actor, PAGE_SIZE, bounds.offset)
    .all<RoomRow>();
  return { items: rows.results.map((row) => summary(row, actor)), ...bounds };
}

export async function createRoom(db: D1Database, actor: string, requestId: string, mode: RoomMode) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO haojie_rooms
    (id, player1_id, creation_request_id, mode, status, revision, engine_version, ruleset,
     view_version, last_change, created_at, updated_at)
    SELECT ?, ?, ?, ?, 'waiting', 0, ?, ?, ?, 'create', ?, ?
    WHERE (SELECT COUNT(*) FROM haojie_rooms WHERE player1_id = ? AND created_at > ?) < 4
    ON CONFLICT(player1_id, creation_request_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      actor,
      requestId,
      mode,
      HAOJIE_ENGINE_VERSION,
      HAOJIE_RULESET,
      PLAYER_VIEW_VERSION,
      now,
      now,
      actor,
      now - 1000,
    )
    .run();
  const found = await db
    .prepare(
      `SELECT id, mode FROM haojie_rooms
    WHERE player1_id = ? AND creation_request_id = ?`,
    )
    .bind(actor, requestId)
    .first<{ id: string; mode: string }>();
  if (!found) throw new HaojieError("TOO_MANY_REQUESTS", 429, "创建得太快了，请稍后重试。");
  if (found.mode !== mode)
    throw new HaojieError("REQUEST_REUSED", 409, "这次创建请求已用于另一种模式，请重新创建。");
  return (await getRoom(db, found.id, actor))!;
}

// The wire body is bounded and commands have already passed the engine parser.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

async function requestHash(input: MutationInput) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(input)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function successful(receipt: ReceiptRow, hash: string, row: RoomRow, actor: string): RoomMutation {
  if (receipt.requestHash !== hash)
    throw new HaojieError("REQUEST_REUSED", 409, "请求编号已被使用，请同步局面后重新操作。");
  if (row.revision < receipt.revision) throw new Error("HAOJIE_RECEIPT_AHEAD");
  return { ...snapshot(row, actor), receipt: { ok: true, revision: receipt.revision } };
}

export async function mutateRoom(
  db: D1Database,
  id: string,
  actor: string,
  input: MutationInput,
): Promise<RoomMutation> {
  const hash = await requestHash(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now();
    const [rooms, receipts, rate] = await db.batch([
      roomQuery(db, id, actor),
      db
        .prepare(
          `SELECT request_hash AS requestHash, revision FROM haojie_requests
        WHERE room_id = ? AND actor_id = ? AND request_id = ?`,
        )
        .bind(id, actor, input.requestId),
      db
        .prepare(
          "SELECT COUNT(*) AS total FROM haojie_requests WHERE actor_id = ? AND created_at > ?",
        )
        .bind(actor, now - 1000),
    ]);
    const row = requireRoom(rooms.results[0] as RoomRow | undefined);
    const receipt = receipts.results[0] as ReceiptRow | undefined;
    if (receipt) return successful(receipt, hash, row, actor);
    if (
      row.engineVersion !== HAOJIE_ENGINE_VERSION ||
      input.engineVersion !== HAOJIE_ENGINE_VERSION ||
      row.ruleset !== HAOJIE_RULESET ||
      row.viewVersion !== PLAYER_VIEW_VERSION
    )
      throw new HaojieError("ENGINE_MISMATCH", 409, "游戏版本已变化，请刷新页面后继续。");
    if (Number((rate.results[0] as { total: number } | undefined)?.total) >= 16)
      throw new HaojieError("TOO_MANY_REQUESTS", 429, "操作过于频繁，请稍后重试。");

    const viewer = summary(row, actor).viewer;
    let nextState = row.stateJson ? (JSON.parse(row.stateJson) as GameState) : null;
    let nextPlayer2 = row.player2Id;
    let nextStatus = row.status;
    let winner = row.winner;
    let endReason = row.endReason;
    if (input.kind === "join") {
      if (viewer) return { ...snapshot(row, actor), receipt: { ok: true, revision: row.revision } };
      if (row.status !== "waiting" || row.player2Id)
        throw new HaojieError("ROOM_FULL", 409, "房间已满或已经结束。");
      if (input.baseRevision !== row.revision)
        throw new HaojieError("REVISION_CONFLICT", 409, "房间状态已变化，请重试加入。");
      nextPlayer2 = actor;
      nextState = createGame(crypto.getRandomValues(new Uint32Array(1))[0] || 1, row.mode);
      nextStatus = "playing";
    } else {
      if (!viewer) throw new HaojieError("ROOM_FORBIDDEN", 403, "你不是这局的玩家。");
      const rebase =
        input.kind === "command" &&
        nextState &&
        input.baseRevision < row.revision &&
        canRebasePlayerCommand(nextState, viewer, input.command);
      if (input.baseRevision !== row.revision && !rebase)
        throw new HaojieError("REVISION_CONFLICT", 409, "局面已更新，请根据最新局面重新操作。");
      if (input.kind === "cancel") {
        if (viewer !== 1 || row.status !== "waiting")
          throw new HaojieError("ROOM_STATUS_CONFLICT", 409, "只能取消自己尚未开始的房间。");
        nextStatus = "cancelled";
        endReason = "cancel";
      } else {
        if (row.status !== "playing" || !nextState)
          throw new HaojieError("ROOM_STATUS_CONFLICT", 409, "当前房间不在对局中。");
        if (input.kind === "resign") {
          winner = viewer === 1 ? "2" : "1";
          endReason = "resign";
          nextStatus = "finished";
        } else {
          try {
            nextState = applyPlayerCommand(nextState, viewer, input.command);
          } catch (error) {
            if (error instanceof RuleError)
              throw new HaojieError("COMMAND_REJECTED", 422, error.message);
            throw error;
          }
          if (nextState.winner) {
            winner = String(nextState.winner) as RoomRow["winner"];
            endReason = "game";
            nextStatus = "finished";
          }
        }
      }
    }

    try {
      await db.batch([
        // A zero-row CAS is not an error in SQL. Make a losing guard fail the batch instead.
        db
          .prepare(
            `UPDATE haojie_rooms SET revision = CASE
          WHEN revision = ? AND status = ? AND engine_version = ?
            AND (SELECT COUNT(*) FROM haojie_requests WHERE actor_id = ? AND created_at > ?) < 16
          THEN revision ELSE NULL END WHERE id = ?`,
          )
          .bind(row.revision, row.status, row.engineVersion, actor, now - 1000, id),
        db
          .prepare(
            `INSERT INTO haojie_requests
          (room_id, actor_id, request_id, kind, request_hash, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, actor, input.requestId, input.kind, hash, row.revision + 1, now),
        db
          .prepare(
            `UPDATE haojie_rooms SET player2_id = ?, status = ?, state_json = ?,
          revision = revision + 1, last_change = ?, winner = ?, end_reason = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(
            nextPlayer2,
            nextStatus,
            nextState ? JSON.stringify(nextState) : null,
            input.kind,
            winner,
            endReason,
            now,
            id,
          ),
      ]);
    } catch (error) {
      const [currentRooms, currentReceipts, currentRate] = await db.batch([
        roomQuery(db, id, actor),
        db
          .prepare(
            `SELECT request_hash AS requestHash, revision FROM haojie_requests
          WHERE room_id = ? AND actor_id = ? AND request_id = ?`,
          )
          .bind(id, actor, input.requestId),
        db
          .prepare(
            "SELECT COUNT(*) AS total FROM haojie_requests WHERE actor_id = ? AND created_at > ?",
          )
          .bind(actor, Date.now() - 1000),
      ]);
      const current = requireRoom(currentRooms.results[0] as RoomRow | undefined);
      const saved = currentReceipts.results[0] as ReceiptRow | undefined;
      if (saved) return successful(saved, hash, current, actor);
      if (Number((currentRate.results[0] as { total: number } | undefined)?.total) >= 16)
        throw new HaojieError("TOO_MANY_REQUESTS", 429, "操作过于频繁，请稍后重试。");
      if (current.revision !== row.revision) continue;
      throw error;
    }
    const savedRow: RoomRow = {
      ...row,
      player2Id: nextPlayer2,
      status: nextStatus,
      revision: row.revision + 1,
      stateJson: nextState ? JSON.stringify(nextState) : null,
      lastChange: input.kind,
      winner,
      endReason,
      updatedAt: now,
    };
    // Join needs the authenticated guest's display name; reads never expose another seat's view.
    if (input.kind === "join")
      return {
        ...(await getRoom(db, id, actor))!,
        receipt: { ok: true, revision: savedRow.revision },
      };
    return {
      ...snapshot(savedRow, actor, row.revision),
      receipt: { ok: true, revision: savedRow.revision },
    };
  }
  throw new HaojieError("REVISION_CONFLICT", 409, "局面正在更新，请同步后重试。");
}
