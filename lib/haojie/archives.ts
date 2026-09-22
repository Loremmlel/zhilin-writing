import { pageBounds, PAGE_SIZE } from "../pagination.ts";
import { HaojieError } from "./contracts.ts";

export type ArchiveRoom = {
  id: string;
  mode: "classic" | "shrine";
  status: "waiting" | "playing" | "finished" | "cancelled";
  revision: number;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  engineVersion: string;
  ruleset: string;
  viewVersion: number;
  winner: string | null;
  endReason: string | null;
  createdAt: number;
  updatedAt: number;
  recordingComplete: number;
  archiveKey: string | null;
  archiveBytes: number | null;
  archivedAt: number | null;
  recordCount: number;
};
const columns = `r.id, r.mode, r.status, r.revision, r.player1_id AS player1Id, p1.display_name AS player1Name,
  r.player2_id AS player2Id, p2.display_name AS player2Name, r.engine_version AS engineVersion,
  r.ruleset, r.view_version AS viewVersion, r.winner, r.end_reason AS endReason,
  r.created_at AS createdAt, r.updated_at AS updatedAt, r.recording_complete AS recordingComplete,
  r.archive_key AS archiveKey, r.archive_bytes AS archiveBytes, r.archived_at AS archivedAt,
  (SELECT COUNT(*) FROM haojie_records h WHERE h.room_id = r.id) AS recordCount`;
const joins = `FROM haojie_rooms r JOIN users p1 ON p1.id = r.player1_id LEFT JOIN users p2 ON p2.id = r.player2_id`;

export async function listArchiveRooms(db: D1Database, page = 1) {
  const count = await db
    .prepare("SELECT COUNT(*) AS total FROM haojie_rooms")
    .first<{ total: number }>();
  const bounds = pageBounds(count?.total ?? 0, page);
  const rows = await db
    .prepare(`SELECT ${columns} ${joins} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`)
    .bind(PAGE_SIZE, bounds.offset)
    .all<ArchiveRoom>();
  return { items: rows.results, ...bounds };
}

export async function archiveRoomInfo(db: D1Database, id: string) {
  const room = await db
    .prepare(`SELECT ${columns} ${joins} WHERE r.id = ?`)
    .bind(id)
    .first<ArchiveRoom>();
  if (!room) throw new HaojieError("ROOM_UNAVAILABLE", 404, "房间不存在。");
  return room;
}

// Only the administrator entry point calls this; expectedRevision protects a live game from a stale dialog.
export async function abortRoom(
  db: D1Database,
  id: string,
  actorId: string,
  expectedRevision: number,
) {
  const room = await archiveRoomInfo(db, id);
  if (room.endReason === "aborted") return; // Safe retry after a lost response.
  if (!["waiting", "playing"].includes(room.status))
    throw new HaojieError("ROOM_FINISHED", 409, "对局已经结束，请刷新列表。");
  if (room.revision !== expectedRevision)
    throw new HaojieError("REVISION_CONFLICT", 409, "局面已变化，请刷新列表后重新确认。");
  const now = Date.now();
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE haojie_rooms SET revision = CASE WHEN revision = ? AND status = ? THEN revision + 1 ELSE NULL END,
        status = CASE WHEN status = 'waiting' THEN 'cancelled' ELSE 'finished' END,
        winner = NULL, end_reason = 'aborted', last_change = 'admin-abort', undo_json = NULL, updated_at = ? WHERE id = ?`,
        )
        .bind(expectedRevision, room.status, now, id),
      db
        .prepare(
          `INSERT INTO haojie_records (room_id, revision, record_json)
        SELECT id, revision, json_object('revision', revision, 'kind', 'admin-abort', 'actorId', ?, 'createdAt', ?,
          'state', json(state_json), 'status', status, 'winner', NULL, 'endReason', 'aborted') FROM haojie_rooms WHERE id = ?`,
        )
        .bind(actorId, now, id),
    ]);
  } catch (error) {
    const current = await archiveRoomInfo(db, id);
    if (current.endReason === "aborted") return;
    if (current.revision !== expectedRevision)
      throw new HaojieError("REVISION_CONFLICT", 409, "局面已变化，请刷新列表后重新确认。");
    throw error;
  }
}

// Terminal rooms are immutable. Page the journal and stream a known byte length to R2,
// so neither polls nor archive uploads load a whole long game into Worker memory.
export async function archiveRoom(db: D1Database, bucket: R2Bucket, id: string) {
  const room = await archiveRoomInfo(db, id);
  if (!["finished", "cancelled"].includes(room.status))
    throw new HaojieError("ROOM_NOT_FINISHED", 409, "对局尚未结束。");
  if (room.archiveKey) return room.archiveKey;
  const metadata = {
    id,
    mode: room.mode,
    status: room.status,
    revision: room.revision,
    players: [
      { id: room.player1Id, name: room.player1Name },
      ...(room.player2Id ? [{ id: room.player2Id, name: room.player2Name }] : []),
    ],
    engineVersion: room.engineVersion,
    ruleset: room.ruleset,
    viewVersion: room.viewVersion,
    winner: room.winner,
    endReason: room.endReason,
    createdAt: room.createdAt,
    endedAt: room.updatedAt,
    historyComplete: !!room.recordingComplete,
    recordCount: room.recordCount,
  };
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    JSON.stringify({ formatVersion: 1, room: metadata }).slice(0, -1) + ',"records":[',
  );
  const suffix = encoder.encode("]}");
  const size = await db
    .prepare(
      `SELECT COALESCE(SUM(length(CAST(record_json AS BLOB))), 0) AS bytes
    FROM haojie_records WHERE room_id = ?`,
    )
    .bind(id)
    .first<{ bytes: number }>();
  const bytes =
    prefix.byteLength + suffix.byteLength + (size?.bytes ?? 0) + Math.max(0, room.recordCount - 1);
  let revision = -1;
  let count = 0;
  let began = false;
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!began) {
        began = true;
        controller.enqueue(prefix);
        return;
      }
      const rows = await db
        .prepare(
          `SELECT revision, record_json AS recordJson FROM haojie_records
        WHERE room_id = ? AND revision > ? ORDER BY revision LIMIT 20`,
        )
        .bind(id, revision)
        .all<{ revision: number; recordJson: string }>();
      if (!rows.results.length) {
        if (count !== room.recordCount) throw new Error("HAOJIE_ARCHIVE_COUNT_MISMATCH");
        controller.enqueue(suffix);
        controller.close();
        return;
      }
      for (const row of rows.results) {
        controller.enqueue(encoder.encode((count++ ? "," : "") + row.recordJson));
        revision = row.revision;
      }
    },
  });
  const fixed = new FixedLengthStream(bytes);
  const abort = new AbortController();
  const key = `haojie-archives/${id}/${room.revision}.json`;
  try {
    await Promise.all([
      source.pipeTo(fixed.writable, { signal: abort.signal }),
      bucket.put(key, fixed.readable, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      }),
    ]);
  } catch (error) {
    abort.abort();
    throw error;
  }
  // Retain every source record even if upload/metadata finalization fails; retry uses the same key.
  await db
    .prepare(
      `UPDATE haojie_rooms SET archive_key = ?, archive_bytes = ?, archived_at = ?
    WHERE id = ? AND revision = ? AND status IN ('finished', 'cancelled') AND archive_key IS NULL`,
    )
    .bind(key, bytes, Date.now(), id, room.revision)
    .run();
  return key;
}
