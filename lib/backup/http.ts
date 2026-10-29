import {
  BackupError,
  databaseSnapshot,
  fileInventory,
  writeBackup,
  backupManifest,
  backupLength,
} from "./export.ts";
import { isSameOriginMutation } from "../auth/password-policy.ts";

export const backupHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Authorization",
};

type Dependencies = {
  access(): Promise<{ ok: boolean; status?: number }>;
  db: D1Database;
  bucket: R2Bucket;
  restoreScript: string;
  log(error: unknown): string;
};

export async function handleBackup(request: Request, dependencies: Dependencies) {
  const fail = (error: string, status: number, incidentId?: string) =>
    Response.json({ error, incidentId }, { status, headers: backupHeaders });
  if (request.method !== "POST") return fail("请从管理后台发起备份。", 405);
  if (!isSameOriginMutation(request)) return fail("请从本站管理后台发起备份。", 403);
  try {
    const access = await dependencies.access();
    if (!access.ok)
      return fail("登录已失效或没有管理员权限，请重新登录后重试。", access.status ?? 403);
    if (!dependencies.db || !dependencies.bucket) throw new Error("BACKUP_BINDING_UNAVAILABLE");
    const startedAt = new Date().toISOString();
    const snapshot = await databaseSnapshot(dependencies.db);
    const inventory = await fileInventory(dependencies.bucket, snapshot.references);
    const manifest = backupManifest(snapshot, inventory);
    manifest.startedAt = startedAt;
    const length = backupLength(snapshot, manifest, dependencies.restoreScript);
    const stream = new FixedLengthStream(length);
    const writer = stream.writable.getWriter();
    const sink = new WritableStream<Uint8Array>({
      write: (chunk) => writer.write(chunk),
      close: () => writer.close(),
    });
    void writeBackup(
      sink,
      snapshot,
      inventory,
      dependencies.db,
      dependencies.bucket,
      dependencies.restoreScript,
      manifest,
      request.signal,
    ).catch(async (error) => {
      if (!(error instanceof BackupError) && !request.signal.aborted) dependencies.log(error);
      await writer.abort(error).catch(() => {});
    });
    return new Response(stream.readable, {
      headers: {
        ...backupHeaders,
        "Content-Type": "application/zip",
        "Content-Length": String(length),
        "Content-Disposition": `attachment; filename="zhilin-backup-${new Date().toISOString().slice(0, 10)}.zip"`,
      },
    });
  } catch (error) {
    if (error instanceof BackupError) return fail(error.message, 409);
    return fail("备份失败，请稍后重试。", 500, dependencies.log(error));
  }
}
