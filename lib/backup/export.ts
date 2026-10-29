import { createHash } from "node:crypto";
import { ZipWriter, TextReader } from "@zip.js/zip.js";

// Explicit inventory: new tables must be classified before they can leave the server.
export const BACKUP_TABLES = [
  "allowed_users",
  "users",
  "member_passwords",
  "member_sessions",
  "login_attempts",
  "haojie_rooms",
  "haojie_history",
  "haojie_records",
  "haojie_requests",
  "posts",
  "replies",
  "annotations",
  "annotation_replies",
  "admin_audit_log",
  "activity_events",
  "notifications",
  "tags",
  "post_tags",
  "assets",
  "post_revisions",
  "import_batches",
  "post_annotation_anchors",
  "revision_annotation_states",
  "revision_imported_reply_states",
  "post_asset_refs",
  "revision_asset_refs",
  "performance_logs",
] as const;
export const OMITTED_RECORDS = ["member_passwords", "member_sessions", "login_attempts"];
// ponytail: paged, two-pass reads avoid whole-database buffering; this is not an atomic snapshot.
const PAGE_BYTES = 256 * 1024;
export class BackupError extends Error {}
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const encoder = new TextEncoder();
type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
type TablePlan = {
  name: string;
  expression: string;
  count: number;
  bytes: number;
  pageSize: number;
  captured?: string[];
};
const schemaQuery =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations', '__drizzle_migrations', '__appgarden_migrations') AND tbl_name NOT IN ('d1_migrations', '__drizzle_migrations', '__appgarden_migrations') ORDER BY type, name";
const referencesQuery = `SELECT DISTINCT a.r2_key AS key, a.deleted_at AS deleted FROM assets a WHERE a.status='permanent' OR EXISTS (SELECT 1 FROM post_asset_refs r WHERE r.asset_id=a.id) OR EXISTS (SELECT 1 FROM revision_asset_refs r WHERE r.asset_id=a.id) OR EXISTS (SELECT 1 FROM users u WHERE u.avatar_asset_id=a.id) UNION SELECT archive_key AS key, NULL AS deleted FROM haojie_rooms WHERE archive_key IS NOT NULL`;

export async function databaseSnapshot(db: D1Database) {
  const schema = (await db.prepare(schemaQuery).all<SchemaRow>()).results;
  const tables = schema
    .filter((row) => row.type === "table")
    .map((row) => row.name)
    .sort();
  if (JSON.stringify(tables) !== JSON.stringify([...BACKUP_TABLES].sort())) {
    // This response is reachable only after administrator authorization. No row values.
    const unexpected = tables.filter(
      (name) => !(BACKUP_TABLES as readonly string[]).includes(name),
    );
    const missing = BACKUP_TABLES.filter((name) => !tables.includes(name));
    const diagnostic = (names: readonly string[]) =>
      JSON.stringify(names.slice(0, 20).map((name) => name.slice(0, 100)));
    throw new BackupError(
      `数据库结构已变化，请更新备份功能后再导出。未知表：${diagnostic(unexpected)}；缺少表：${diagnostic(missing)}`,
    );
  }
  const plans: TablePlan[] = [];
  for (const table of tables.filter((table) => !OMITTED_RECORDS.includes(table))) {
    const columns = (
      await db.prepare(`PRAGMA table_info(${identifier(table)})`).all<{ name: string }>()
    ).results;
    const names = columns.map((column) => column.name);
    // SQLite formats its own values, preserving int64 and blobs. quote() truncates NUL text, so hex just that case.
    const values = names
      .map((name) => {
        const column = identifier(name);
        return `CASE WHEN typeof(${column})='text' AND instr(${column},char(0))>0 THEN 'CAST(X''' || hex(${column}) || ''' AS TEXT)' ELSE quote(${column}) END`;
      })
      .join(" || ',' || ");
    const expression = `${literal(`INSERT INTO ${identifier(table)} (${names.map(identifier).join(",")}) VALUES (`)} || ${values} || ');'`;
    if (table === "performance_logs") {
      // The browser itself writes telemetry during downloads. This table has a DB-enforced 5,000-row cap.
      const rows = (
        await db
          .prepare(
            `SELECT ${expression} AS statement FROM performance_logs ORDER BY rowid LIMIT 5001`,
          )
          .all<{ statement: string }>()
      ).results;
      if (rows.length > 5000)
        throw new BackupError("诊断日志超出预期限额，请联系维护者检查数据库。");
      const captured = rows.map((row) => row.statement + "\n");
      plans.push({
        name: table,
        expression,
        count: rows.length,
        bytes: captured.reduce((sum, row) => sum + encoder.encode(row).length, 0),
        pageSize: 100,
        captured,
      });
      continue;
    }
    const stats = await db
      .prepare(
        `SELECT count(*) AS count, coalesce(sum(length(CAST((${expression}) AS BLOB))+1),0) AS bytes, coalesce(max(length(CAST((${expression}) AS BLOB))+1),1) AS largest FROM ${identifier(table)}`,
      )
      .first<{ count: number; bytes: number; largest: number }>();
    plans.push({
      name: table,
      expression,
      count: stats!.count,
      bytes: stats!.bytes,
      pageSize: Math.max(1, Math.min(100, Math.floor(PAGE_BYTES / stats!.largest))),
    });
  }
  const prefix =
    "-- Zhilin portable backup; authentication records intentionally omitted.\nPRAGMA defer_foreign_keys=ON;\n" +
    schema
      .filter((row) => row.type === "table")
      .map((row) => `${row.sql};\n`)
      .join("");
  const suffix = schema
    .filter((row) => row.type !== "table")
    .map((row) => `${row.sql};\n`)
    .join("");
  const rowCounts = Object.fromEntries(
    tables.map((table) => [table, plans.find((plan) => plan.name === table)?.count ?? 0]),
  );
  return {
    schema,
    plans,
    prefix,
    suffix,
    rowCounts,
    bytes:
      encoder.encode(prefix + suffix).length + plans.reduce((sum, plan) => sum + plan.bytes, 0),
    references: (await db.prepare(referencesQuery).all<{ key: string; deleted: number | null }>())
      .results,
  };
}

async function* tableRows(db: D1Database, plan: TablePlan) {
  if (plan.captured) {
    for (const row of plan.captured) yield encoder.encode(row);
    return;
  }
  let cursor: string | null = null;
  let count = 0,
    bytes = 0;
  do {
    const rows: { cursor: string; statement: string }[] = (
      await db
        .prepare(
          `SELECT CAST(rowid AS TEXT) AS cursor, ${plan.expression} AS statement FROM ${identifier(plan.name)} WHERE (? IS NULL OR rowid > CAST(? AS INTEGER)) ORDER BY rowid LIMIT ?`,
        )
        .bind(cursor, cursor, plan.pageSize)
        .all<{ cursor: string; statement: string }>()
    ).results;
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.cursor;
      count++;
      const chunk = encoder.encode(row.statement + "\n");
      bytes += chunk.length;
      if (count > plan.count || bytes > plan.bytes)
        throw new BackupError("导出期间数据发生变化，请暂停编辑后重试。");
      yield chunk;
    }
  } while (true);
  if (count !== plan.count || bytes !== plan.bytes)
    throw new BackupError("导出期间数据发生变化，请暂停编辑后重试。");
}

export async function fileInventory(
  bucket: R2Bucket,
  references: { key: string; deleted: number | null }[],
) {
  const objects: R2Object[] = [],
    alreadyDeleted: string[] = [];
  const refs = new Map<string, boolean>();
  for (const ref of references)
    refs.set(ref.key, (refs.get(ref.key) ?? false) || ref.deleted === null);
  for (const [key, required] of refs) {
    const object = await bucket.head(key);
    if (object) objects.push(object);
    else if (required)
      throw new BackupError(
        "有仍在使用的附件或对局档案缺失，可能正在变更；请稍后重试或联系维护者。",
      );
    else alreadyDeleted.push(key);
  }
  return { objects, alreadyDeleted };
}

type Snapshot = Awaited<ReturnType<typeof databaseSnapshot>>;
type Inventory = Awaited<ReturnType<typeof fileInventory>>;
export function backupManifest(snapshot: Snapshot, inventory: Inventory) {
  return {
    format: "zhilin-backup-v1",
    startedAt: new Date().toISOString(),
    completedAt: "0000-00-00T00:00:00.000Z",
    sqlSha256: "0".repeat(64),
    rowCounts: snapshot.rowCounts,
    omittedRecords: OMITTED_RECORDS,
    alreadyDeletedFiles: inventory.alreadyDeleted,
    files: inventory.objects.map((object, index) => ({
      path: `files/${String(index + 1).padStart(6, "0")}`,
      key: object.key,
      size: object.size,
      etag: object.etag,
      sha256: "0".repeat(64),
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    })),
  };
}
// zip.js 2.8.60 STORE + forced ZIP64, no timestamps/comments: exact headers, descriptors and directory.
export function zipLength(entries: { name: string; size: number }[]) {
  let length = 98,
    offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name).length;
    length += entry.size + 140 + 2 * nameBytes + (offset >= 0xffffffff ? 8 : 0);
    offset += 74 + nameBytes + entry.size;
  }
  if (!Number.isSafeInteger(length)) throw new BackupError("备份大小超出下载支持范围。");
  return length;
}
export function backupLength(
  snapshot: Snapshot,
  manifest: ReturnType<typeof backupManifest>,
  restoreScript: string,
) {
  return zipLength([
    { name: "database.sql", size: snapshot.bytes },
    { name: "restore.py", size: encoder.encode(restoreScript).length },
    { name: "README.txt", size: encoder.encode(BACKUP_README).length },
    ...manifest.files.map((file) => ({ name: file.path, size: file.size })),
    { name: "manifest.json", size: encoder.encode(JSON.stringify(manifest, null, 2)).length },
  ]);
}

export async function writeBackup(
  writable: WritableStream<Uint8Array>,
  snapshot: Snapshot,
  inventory: Inventory,
  db: D1Database,
  bucket: R2Bucket,
  restoreScript: string,
  manifest = backupManifest(snapshot, inventory),
  signal?: AbortSignal,
) {
  const zip = new ZipWriter(writable, {
    level: 0,
    zip64: true,
    extendedTimestamp: false,
    dataDescriptor: true,
    useWebWorkers: false,
  });
  const sqlHash = createHash("sha256"),
    hashes = new Map<string, string>();
  async function* sqlChunks() {
    yield encoder.encode(snapshot.prefix);
    for (const plan of snapshot.plans) {
      const hash = createHash("sha256");
      for await (const chunk of tableRows(db, plan)) {
        signal?.throwIfAborted();
        hash.update(chunk);
        yield chunk;
      }
      hashes.set(plan.name, hash.digest("hex"));
    }
    yield encoder.encode(snapshot.suffix);
  }
  const iterator = sqlChunks();
  const sqlStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else {
        sqlHash.update(next.value);
        controller.enqueue(next.value);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  await zip.add("database.sql", sqlStream, { signal });
  manifest.sqlSha256 = sqlHash.digest("hex");
  const addText = (name: string, value: string) => zip.add(name, new TextReader(value), { signal });
  await addText("restore.py", restoreScript);
  await addText("README.txt", BACKUP_README);
  for (const [index, expected] of inventory.objects.entries()) {
    signal?.throwIfAborted();
    const object = await bucket.get(expected.key, { onlyIf: { etagMatches: expected.etag } });
    if (!object || !("body" in object) || object.size !== expected.size)
      throw new BackupError("备份期间文件已变化或丢失，请重新导出。");
    const hash = createHash("sha256");
    const checked = (object.body as ReadableStream<Uint8Array>).pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          hash.update(chunk);
          controller.enqueue(chunk);
        },
      }),
    );
    await zip.add(manifest.files[index].path, checked, { signal });
    manifest.files[index].sha256 = hash.digest("hex");
  }
  // A second bounded pass catches edits (even same-length edits), inserts and removals while streaming.
  for (const plan of snapshot.plans) {
    const hash = createHash("sha256");
    for await (const chunk of tableRows(db, plan)) {
      signal?.throwIfAborted();
      hash.update(chunk);
    }
    if (hash.digest("hex") !== hashes.get(plan.name))
      throw new BackupError("导出期间数据发生变化，请暂停编辑后重试。");
  }
  const schema = (await db.prepare(schemaQuery).all<SchemaRow>()).results;
  if (
    JSON.stringify(schema) !== JSON.stringify(snapshot.schema) ||
    (await db.prepare("PRAGMA foreign_key_check").all()).results.length
  )
    throw new BackupError("数据库结构或关联关系发生变化，请暂停编辑后重试。");
  manifest.completedAt = new Date().toISOString();
  await addText("manifest.json", JSON.stringify(manifest, null, 2));
  await zip.close();
}

export const BACKUP_README = `知临中学 · 应用数据备份\n\n解压到私密文件夹，在该文件夹运行：\n  python3 restore.py\nWindows 可使用：py restore.py\n脚本仅使用 Python 标准库，在同目录生成真正的 zhilin.db，验证完整性、外键与行数；不会覆盖现有数据库。\n\n范围：全部 27 张应用表的结构，除密码、会话、登录限流记录外的全部数据（包括隐藏/软删除内容、成员邮箱、白名单、历史、通知、管理/性能日志及游戏数据），以及业务记录引用的现存 R2 对象（包括历史版本、软删除内容与对局档案引用）。\nmember_passwords、member_sessions、login_attempts 仅保留空表。恢复后必须由管理员重新设置本地登录密码，成员重新登录；ChatGPT 身份与环境密钥/OAuth 配置不在备份中，须单独配置。\n已物理删除的数据无法恢复；已清理的软删除附件记录仍保留，缺失文件列于 manifest.json 的 alreadyDeletedFiles。无业务引用的临时/孤立文件、浏览器本地未提交草稿、平台内部表与部署配置不在其中。\n\nfiles/ 下使用安全编号。manifest.json 记录原始 R2 key、大小、ETag 与元数据；还原网站时需由维护者将这些文件按 key 和元数据上传到受保护的 R2 存储桶，并将 database.sql 导入空的兼容 SQLite/D1 数据库。不要直接把 zhilin.db 当成可上传的 D1 文件（D1 导入 SQL）。本功能不自动覆盖线上数据。\n\n一致性：数据库分页读取，不是全库事务快照，也不是数据库与 R2 的跨服务原子快照。开始/结束时间见 manifest.json。性能诊断日志为导出开始阶段的一次有界快照（现有滚动上限5,000条），不因下载页面自身新增探针记录而中止。导出后再次逐页核对数据库内容哈希，能发现变化则中止；仍不能保证并发写入时的原子一致性。文件按清单中的 ETag 条件读取，变更/缺失会终止下载，不静默跳过。导出时请暂停编辑、上传、归档与清理；导出期间新建的对象可能不在本次备份中。\n数据与文件均流式写入，无人为小容量截断；仍受平台请求时长、CPU、子请求数量和设备存储容量限制。失败下载不具备完整 ZIP 目录或有效校验，不能当成备份。\n\n安全：备份含私密内容及成员邮箱，不含登录密码/会话。妥善加密保存，不要上传到 GitHub 或公开网盘。只有下载完整且 restore.py 验证通过的 ZIP 才可作为有效备份。\n`;
