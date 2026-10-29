import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import {
  databaseSnapshot,
  fileInventory,
  writeBackup,
  BackupError,
} from "../../lib/backup/export.ts";
import { handleBackup } from "../../lib/backup/http.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const restoreScript = await readFile(
  new URL("../../lib/backup/restore.py", import.meta.url),
  "utf8",
);
const bundle = await build({
  stdin: {
    contents: `import { handleBackup } from './lib/backup/http.ts';
export default { fetch(request, env) { return handleBackup(request, { db:env.DB, bucket:env.BUCKET, restoreScript:${JSON.stringify(restoreScript)}, access: async()=>({ok:request.headers.get('x-test-role')==='admin',status:request.headers.get('x-test-role')?403:401}), log:()=> 'test-incident' }); } };`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const mf = new Miniflare({
  modulesRoot: root,
  modules: [
    {
      type: "ESModule",
      path: join(root, "tests/fixtures/backup-test.mjs"),
      contents: bundle.outputFiles[0].text,
    },
  ],
  compatibilityDate: "2026-04-01",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB", "RESTORED"],
  r2Buckets: ["BUCKET"],
});
let db: D1Database;
let bucket: R2Bucket;
const image = new Uint8Array([0, 255, 128, 1, 3, 0]);
const call = (role: string | null = "admin", origin = "https://backup.test", method = "POST") =>
  mf.dispatchFetch("https://backup.test/api/admin/backup", {
    method,
    headers: { origin, ...(role ? { "x-test-role": role } : {}) },
  });
before(async () => {
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  bucket = (await mf.getR2Bucket("BUCKET")) as unknown as R2Bucket;
  // Real Drizzle deployments create this ledger before applying migration SQL.
  await db
    .prepare(
      "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
    )
    .run();
  await db
    .prepare("INSERT INTO __drizzle_migrations VALUES (1, 'synthetic-migration-hash', 1)")
    .run();
  for (const name of (await readdir(join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    const sql = await readFile(join(root, "drizzle", name), "utf8");
    await db.batch(
      sql
        .split("--> statement-breakpoint")
        .filter((sql) => sql.trim())
        .map((sql) => db.prepare(sql)),
    );
  }
});
after(() => mf.dispose());

async function unpack(response: {
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}) {
  assert.equal(
    response.status,
    200,
    await (response.status === 200 ? Promise.resolve("") : response.text()),
  );
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(await response.arrayBuffer())), {
    useWebWorkers: false,
  });
  const files = new Map<string, Uint8Array>();
  for (const entry of await reader.getEntries()) {
    if (!entry.directory)
      files.set(
        entry.filename,
        await entry.getData!(new Uint8ArrayWriter(), { checkSignature: true }),
      );
  }
  await reader.close();
  return files;
}
async function restored(
  files: Map<string, Uint8Array>,
  verify: (db: DatabaseSync, folder: string) => Promise<void> | void,
) {
  const folder = await mkdtemp(join(tmpdir(), "zhilin-backup-test-"));
  try {
    for (const [name, data] of files) {
      if (name.startsWith("files/")) execFileSync("mkdir", ["-p", join(folder, "files")]);
      await writeFile(join(folder, name), data);
    }
    execFileSync("python3", [join(folder, "restore.py")]);
    const sql = new DatabaseSync(join(folder, "zhilin.db"));
    try {
      await verify(sql, folder);
    } finally {
      sql.close();
    }
    assert.throws(
      () => execFileSync("python3", [join(folder, "restore.py")], { stdio: "pipe" }),
      /Command failed/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("authorization, CSRF and methods reject before touching data; no-store on all paths", async () => {
  for (const [role, origin, method, status] of [
    [null, "https://backup.test", "POST", 401],
    ["member", "https://backup.test", "POST", 403],
    ["game", "https://backup.test", "POST", 403],
    ["admin", "https://evil.test", "POST", 403],
    ["admin", "", "POST", 403],
    ["admin", "https://backup.test", "GET", 405],
  ] as const) {
    const response = await handleBackup(
      new Request("https://backup.test/api/admin/backup", { method, headers: { origin } }),
      {
        access: async () => ({ ok: role === "admin", status: role ? 403 : 401 }),
        db: null as unknown as D1Database,
        bucket: null as unknown as R2Bucket,
        restoreScript,
        log: () => {
          throw new Error("No data/log access permitted");
        },
      },
    );
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
});

test("empty migrated D1 produces a ZIP that restores to a real empty SQLite database", async () => {
  const response = await call();
  assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
  assert.match(
    response.headers.get("content-disposition")!,
    /^attachment; filename="zhilin-backup-\d{4}-\d{2}-\d{2}\.zip"$/,
  );
  await restored(await unpack(response), (restored) => {
    assert.equal(restored.prepare("SELECT count(*) AS count FROM users").get()!.count, 0);
    assert.equal(
      restored
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .get()!.count,
      27,
    );
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("all application rows and files round-trip; secrets absent; UTF-8, NUL, blobs, int64 and foreign keys preserved", async () => {
  await db.batch([
    db.prepare(
      "INSERT INTO allowed_users (id,email,is_admin,added_at) VALUES ('a','fixture@example.test',1,0)",
    ),
    db
      .prepare(
        "INSERT INTO users (id,email_key,display_name,bio,joined_at,updated_at) VALUES ('u','fixture@example.test','中文同学',?,0,0)",
      )
      .bind("带引号'与\u0000空字节"),
    db.prepare(
      "INSERT INTO posts (id,author_id,title,markdown,published_at,last_activity_at,hidden_at) VALUES ('p','u','中文标题','隐藏正文',0,0,1)",
    ),
    db.prepare(
      "INSERT INTO replies (id,post_id,author_id,markdown,published_at,submission_key,deleted_at) VALUES ('r','p','u','已删除回复',0,'s',2)",
    ),
    db.prepare(
      "INSERT INTO assets (id,owner_id,post_id,r2_key,kind,filename,mime_type,byte_size,created_at,status) VALUES ('asset','u','p','../中文.png','image','中文.png','image/png',6,0,'permanent')",
    ),
    db.prepare("INSERT INTO post_asset_refs VALUES ('p','asset','inline')"),
    db.prepare("INSERT INTO member_passwords VALUES ('a','SECRET_PASSWORD_HASH')"),
    db.prepare("INSERT INTO member_sessions VALUES ('SECRET_TOKEN_HASH','a',9999999999999)"),
    db.prepare("INSERT INTO login_attempts VALUES ('SECRET_LOGIN_KEY',1,0)"),
    db.prepare(
      "INSERT INTO performance_logs (created_at,source,record) VALUES (9223372036854775807,'fixture',X'00FF80')",
    ),
  ]);
  await bucket.put("../中文.png", image, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { fixture: "中文" },
  });
  await bucket.put("unreferenced.bin", "temporary fixture");
  const files = await unpack(await call());
  const text = new TextDecoder().decode(files.get("database.sql"));
  assert.ok(!text.includes("SECRET_"));
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
  assert.equal(manifest.files.length, 1);
  assert.ok([...files.keys()].every((name) => !name.includes("..")));
  assert.deepEqual(
    files.get(manifest.files.find((file: { key: string }) => file.key === "../中文.png").path),
    image,
  );
  await restored(files, (restored) => {
    assert.equal(restored.prepare("SELECT bio FROM users").get()!.bio, "带引号'与\u0000空字节");
    assert.equal(restored.prepare("SELECT hidden_at FROM posts").get()!.hidden_at, 1);
    assert.equal(restored.prepare("SELECT deleted_at FROM replies").get()!.deleted_at, 2);
    assert.equal(restored.prepare("SELECT count(*) AS n FROM member_passwords").get()!.n, 0);
    const statement = restored.prepare("SELECT created_at, record FROM performance_logs");
    statement.setReadBigInts(true);
    const row = statement.get()!;
    assert.equal(row.created_at, BigInt("9223372036854775807"));
    assert.deepEqual(row.record, new Uint8Array([0, 255, 128]));
  });
  // Import the same SQL into a second real local D1, with foreign keys enforced.
  const target = (await mf.getD1Database("RESTORED")) as unknown as D1Database;
  // Each generated INSERT is a single line; schemas/triggers need SQLite-aware splitting.
  const split = execFileSync(
    "python3",
    [
      "-c",
      "import sqlite3,json,sys\ns=sys.stdin.read(); out=[]; buf=''\nfor c in s:\n buf+=c\n if c==';' and sqlite3.complete_statement(buf): out.append(buf);buf=''\nprint(json.dumps(out))",
    ],
    { input: text, encoding: "utf8" },
  );
  await target.batch((JSON.parse(split) as string[]).map((sql) => target.prepare(sql)));
  assert.equal(await target.prepare("SELECT count(*) FROM posts").first("count(*)"), 1);
  assert.deepEqual((await target.prepare("PRAGMA foreign_key_check").all()).results, []);
});

test("missing active files, removed objects, and unknown schema fail closed", async () => {
  await assert.rejects(
    () =>
      fileInventory({ head: async () => null } as unknown as R2Bucket, [
        { key: "missing", deleted: null },
      ]),
    BackupError,
  );
  assert.deepEqual(
    (
      await fileInventory({ head: async () => null } as unknown as R2Bucket, [
        { key: "removed", deleted: 1 },
      ])
    ).alreadyDeleted,
    ["removed"],
  );
  const snapshot = await databaseSnapshot(db),
    inventory = await fileInventory(bucket, snapshot.references);
  const sink = new WritableStream<Uint8Array>({ write() {} });
  await assert.rejects(
    () =>
      writeBackup(
        sink,
        snapshot,
        inventory,
        db,
        { get: async () => null } as unknown as R2Bucket,
        restoreScript,
      ),
    /变化|丢失/,
  );
  await db.prepare("CREATE TABLE newly_added_secret (token TEXT)").run();
  await assert.rejects(() => databaseSnapshot(db), /结构已变化.*newly_added_secret/);
  const denied = await call("member");
  assert.equal(denied.status, 403);
  assert.doesNotMatch(await denied.text(), /newly_added_secret/);
  const mismatch = await call();
  assert.equal(mismatch.status, 409);
  assert.match(await mismatch.text(), /newly_added_secret/);
  await db.prepare("DROP TABLE newly_added_secret").run();
});

test("paged export exceeds former SQL limit, keeps bounded rows, detects same-length concurrent edits", async () => {
  const large = "正文".repeat(40000);
  for (let i = 0; i < 30; i++)
    await db
      .prepare(
        "INSERT INTO posts (id,author_id,title,markdown,published_at,last_activity_at) VALUES (?,'u','较大历史数据',?,0,0)",
      )
      .bind(`large-${i}`, large)
      .run();
  const snapshot = await databaseSnapshot(db);
  assert.ok(snapshot.bytes > 6 * 1024 * 1024);
  const response = await call();
  const contentLength = Number(response.headers.get("content-length"));
  const data = await response.arrayBuffer();
  assert.equal(data.byteLength, contentLength);
  const inventory = await fileInventory(bucket, snapshot.references);
  const telemetryBucket = {
    get: async (...args: Parameters<R2Bucket["get"]>) => {
      await db
        .prepare("INSERT INTO performance_logs (created_at,source,record) VALUES (0,'client','{}')")
        .run();
      return bucket.get(...args);
    },
  } as unknown as R2Bucket;
  await writeBackup(
    new WritableStream({ write() {} }),
    snapshot,
    inventory,
    db,
    telemetryBucket,
    restoreScript,
  );
  let changed = false;
  const changingBucket = {
    get: async (...args: Parameters<R2Bucket["get"]>) => {
      if (!changed) {
        changed = true;
        await db.prepare("UPDATE posts SET title='文中标题' WHERE id='p'").run();
      }
      return bucket.get(...args);
    },
  } as unknown as R2Bucket;
  await assert.rejects(
    () =>
      writeBackup(
        new WritableStream({ write() {} }),
        snapshot,
        inventory,
        db,
        changingBucket,
        restoreScript,
      ),
    /发生变化/,
  );
});
