import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { Miniflare } from "miniflare";
import { ZipReader, Uint8ArrayReader, TextWriter } from "@zip.js/zip.js";
const execute = promisify(execFile);

test("built Worker enforces original admin auth, serves native fixed-length ZIP, and renders the backup UI", async () => {
  const root = fileURLToPath(new URL("../../dist/server/", import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter(
    (file) => file.endsWith(".js") && file !== "index.js",
  );
  const mf = new Miniflare({
    modulesRoot: root,
    modules: ["index.js", ...files].map((file) => ({ type: "ESModule", path: join(root, file) })),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    assets: {
      directory: fileURLToPath(new URL("../../dist/client/", import.meta.url)),
      binding: "ASSETS",
      routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
    },
  });
  const folder = await mkdtemp(join(tmpdir(), "backup-http-"));
  try {
    const db = await mf.getD1Database("DB");
    await db
      .prepare(
        "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
      )
      .run();
    await db
      .prepare("INSERT INTO __drizzle_migrations VALUES (1, 'synthetic-migration-hash', 1)")
      .run();
    for (const file of (await readdir(new URL("../../drizzle/", import.meta.url)))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()) {
      const sql = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
      await db.batch(
        sql
          .split("--> statement-breakpoint")
          .filter((part) => part.trim())
          .map((part) => db.prepare(part)),
      );
    }
    for (const [id, admin, group] of [
      ["admin", 1, "normal"],
      ["member", 0, "normal"],
      ["gamer", 0, "game"],
    ]) {
      await db.batch([
        db
          .prepare(
            "INSERT INTO allowed_users (id,email,is_admin,permission_group,added_at) VALUES (?,?,?,?,0)",
          )
          .bind(id, `${id}@example.test`, admin, group),
        db
          .prepare(
            "INSERT INTO users (id,email_key,display_name,joined_at,updated_at) VALUES (?,?,?,0,0)",
          )
          .bind(id, `${id}@example.test`, id),
      ]);
    }
    const token = "a".repeat(64);
    await db.batch([
      db.prepare("INSERT INTO member_passwords VALUES ('member','fixture-only')"),
      db
        .prepare("INSERT INTO member_sessions VALUES (?,'member',?)")
        .bind(createHash("sha256").update(token).digest("hex"), Date.now() + 60_000),
    ]);
    const request = (actor, extra = {}, method = "POST", path = "/api/admin/backup") =>
      mf.dispatchFetch(`https://site.test${path}`, {
        method,
        headers: {
          Origin: "https://site.test",
          ...(actor ? { "oai-authenticated-user-email": `${actor}@example.test` } : {}),
          ...extra,
        },
      });
    for (const [actor, extra, status] of [
      [null, {}, 401],
      ["member", {}, 403],
      ["gamer", {}, 403],
      ["admin", { Origin: "https://evil.test" }, 403],
      ["admin", { Cookie: "__Host-zhilin-session=bad" }, 401],
      ["admin", { Cookie: `__Host-zhilin-session=${token}` }, 403],
    ]) {
      const response = await request(actor, extra);
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
    await db.prepare("DELETE FROM member_sessions").run();
    assert.equal(
      (await request("admin", { Cookie: `__Host-zhilin-session=${token}` })).status,
      401,
    );
    await db.prepare("DELETE FROM allowed_users WHERE id='member'").run();
    assert.equal((await request("member")).status, 403);
    await db.prepare("UPDATE allowed_users SET is_admin=0 WHERE id='admin'").run();
    assert.equal((await request("admin")).status, 403);
    await db.prepare("UPDATE allowed_users SET is_admin=1 WHERE id='admin'").run();
    assert.equal((await request("admin", {}, "GET")).status, 405);
    const page = await request("admin", {}, "GET", "/admin/backup");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /导出数据备份 ZIP/);
    assert.match(html, /不是全库事务快照/);
    assert.ok(!html.includes("800 个") && !html.includes("100 MiB"));
    // A real HTTP request (not just dispatchFetch) must retain length for browser-native downloads.
    const url = new URL("/api/admin/backup", await mf.ready);
    const output = join(folder, "backup.zip");
    const result = await execute("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "30",
      "-X",
      "POST",
      "-H",
      `Origin: ${url.origin}`,
      "-H",
      "oai-authenticated-user-email: admin@example.test",
      "-D",
      join(folder, "headers.txt"),
      "-o",
      output,
      url.href,
    ]);
    assert.equal(result.stderr, "");
    const bytes = await readFile(output),
      headers = await readFile(join(folder, "headers.txt"), "utf8");
    assert.match(headers, /content-length: \d+/i);
    assert.equal(Number(headers.match(/content-length: (\d+)/i)[1]), bytes.length);
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
    const entries = await reader.getEntries();
    const manifest = JSON.parse(
      await entries
        .find((entry) => entry.filename === "manifest.json")
        .getData(new TextWriter(), { checkSignature: true }),
    );
    assert.equal(manifest.rowCounts.users, 3);
    assert.equal(manifest.rowCounts.member_sessions, 0);
    await reader.close();
    // Exercise more than the discarded 100 MiB ceiling via the actual Worker HTTP socket.
    const bucket = await mf.getR2Bucket("BUCKET");
    const largeSize = 105 * 1024 * 1024;
    await bucket.put("large-fixture.bin", new Uint8Array(largeSize));
    await db
      .prepare(
        "INSERT INTO assets(id,owner_id,r2_key,kind,filename,mime_type,byte_size,status,created_at) VALUES ('large','admin','large-fixture.bin','attachment','large.bin','application/octet-stream',?,'permanent',0)",
      )
      .bind(largeSize)
      .run();
    const largeOutput = join(folder, "large.zip");
    await execute("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "60",
      "-X",
      "POST",
      "-H",
      `Origin: ${url.origin}`,
      "-H",
      "oai-authenticated-user-email: admin@example.test",
      "-o",
      largeOutput,
      url.href,
    ]);
    assert.ok((await stat(largeOutput)).size > largeSize);
    await execute("python3", [
      "-c",
      "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.getinfo('files/000001').file_size == 105*1024*1024",
      largeOutput,
    ]);
    // FixedLengthStream must propagate a mid-stream failure through a real HTTP connection.
    const failHeaders = join(folder, "fail-headers.txt");
    const failedDownload = execute("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "30",
      "--limit-rate",
      "10M",
      "-X",
      "POST",
      "-H",
      `Origin: ${url.origin}`,
      "-H",
      "oai-authenticated-user-email: admin@example.test",
      "-D",
      failHeaders,
      "-o",
      join(folder, "partial.zip"),
      url.href,
    ]).then(
      () => null,
      (error) => error,
    );
    for (let i = 0; i < 200; i++) {
      if (
        await stat(join(folder, "partial.zip")).then(
          (info) => info.size > 1024 * 1024,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await db
      .prepare(
        "INSERT INTO tags (id,name,normalized_name,created_at) VALUES ('concurrent','并发','并发',0)",
      )
      .run();
    const failure = await failedDownload;
    assert.equal(
      failure?.code,
      18,
      "curl must reject an incomplete fixed-length ZIP, not report success",
    );
  } finally {
    await mf.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});
