import { env } from "cloudflare:workers";
import { getActionAdministratorAccess } from "@/lib/auth/access";
import { measuredBucket, measuredDatabase } from "@/lib/performance/server";
import { logServerError } from "@/lib/logging";
import { backupHeaders, handleBackup } from "@/lib/backup/http";
import restoreScript from "@/lib/backup/restore-source";

export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleBackup(request, {
    access: () => getActionAdministratorAccess(request),
    db: env.DB && measuredDatabase(env.DB),
    bucket: env.BUCKET && measuredBucket(env.BUCKET),
    restoreScript,
    log: (error) =>
      logServerError({ operation: "admin.backup", error, errorCode: "ADMIN_BACKUP_FAILED" }),
  });
}
export function GET() {
  return Response.json(
    { error: "请从管理后台发起备份。" },
    { status: 405, headers: { ...backupHeaders, Allow: "POST" } },
  );
}
