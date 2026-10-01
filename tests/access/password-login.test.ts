import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { hashSessionToken } from "../../lib/auth/password-service.ts";
import { safeReturnPath, isSameOriginMutation } from "../../lib/auth/password-policy.ts";

// Run the actual crypto and conditional authentication writes inside workerd/D1.
const bundle = await build({
  stdin: {
    contents: `import * as api from './lib/auth/password-service.ts';
      export default { async fetch(request, env) {
        const body = await request.json();
        const result = body.operation === 'set'
          ? await api.setMemberPassword(env.DB, body.id, body.password)
          : await api.passwordLogin(env.DB, body.email, body.password, body.ip ?? 'test', body.now);
        return Response.json(result);
      } };`,
    resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const mf = new Miniflare({
  modules: true,
  script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-04-01",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
});
let db: D1Database;
const password = "a sufficiently long password";
const replacement = "a different long password";
const now = 1_800_000_000_000;
async function call(body: Record<string, unknown>) {
  const response = await mf.dispatchFetch("https://auth.test", {
    method: "POST",
    body: JSON.stringify({ now, ...body }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { ok?: boolean; limited?: boolean; token?: string } | boolean;
}
before(async () => {
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  await db
    .prepare(
      `CREATE TABLE allowed_users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0,permission_group TEXT NOT NULL DEFAULT 'normal',added_at INTEGER NOT NULL,added_by_user_id TEXT)`,
    )
    .run();
  const migration = await readFile(
    new URL("../../drizzle/0017_flowery_mongoose.sql", import.meta.url),
    "utf8",
  );
  await db.batch(
    migration
      .split("--> statement-breakpoint")
      .filter((sql) => sql.trim())
      .map((sql) => db.prepare(sql.trim())),
  );
  await db
    .prepare(
      `INSERT INTO allowed_users(id,email,is_admin,added_at,added_by_user_id) VALUES('member','member@example.com',0,0,'owner'),('owner','owner@example.com',1,0,NULL),('no-password','no-password@example.com',0,0,'owner')`,
    )
    .run();
});
after(() => mf.dispose());

test("invited members share one email identity, resets revoke sessions, and removal cannot be undone by re-inviting", async () => {
  assert.equal(await call({ operation: "set", id: "member", password }), true);
  assert.equal(await call({ operation: "set", id: "owner", password }), false);
  const stored = await db
    .prepare("SELECT password_hash FROM member_passwords WHERE allowed_user_id='member'")
    .first<{ password_hash: string }>();
  assert.notEqual(stored!.password_hash, password);
  for (const email of ["stranger@example.com", "no-password@example.com"]) {
    assert.deepEqual(await call({ email, password }), { ok: false, limited: false });
  }
  assert.deepEqual(await call({ email: "member@example.com", password: "wrong password" }), {
    ok: false,
    limited: false,
  });
  const result = (await call({ email: "  MEMBER@Example.COM  ", password })) as {
    ok: boolean;
    token: string;
  };
  assert.equal(result.ok, true);
  const session = await db
    .prepare("SELECT allowed_user_id,expires_at FROM member_sessions WHERE token_hash=?")
    .bind(hashSessionToken(result.token))
    .first<{ allowed_user_id: string; expires_at: number }>();
  assert.equal(session!.allowed_user_id, "member");
  assert.equal(session!.expires_at, now + 14 * 24 * 60 * 60 * 1000);
  assert.equal(
    await db
      .prepare("SELECT token_hash FROM member_sessions WHERE token_hash=?")
      .bind(result.token)
      .first(),
    null,
  );
  assert.equal(await call({ operation: "set", id: "member", password: replacement }), true);
  assert.equal(await db.prepare("SELECT token_hash FROM member_sessions").first(), null);
  assert.deepEqual(await call({ email: "member@example.com", password }), {
    ok: false,
    limited: false,
  });
  assert.equal(
    ((await call({ email: "member@example.com", password: replacement })) as { ok: boolean }).ok,
    true,
  );
  await db.prepare("DELETE FROM allowed_users WHERE id='member'").run();
  assert.equal(await db.prepare("SELECT token_hash FROM member_sessions").first(), null);
  assert.equal(await db.prepare("SELECT password_hash FROM member_passwords").first(), null);
  assert.deepEqual(await call({ email: "member@example.com", password: replacement }), {
    ok: false,
    limited: false,
  });
  await db
    .prepare(
      "INSERT INTO allowed_users(id,email,is_admin,added_at,added_by_user_id) VALUES('reinivited','member@example.com',0,0,'owner')",
    )
    .run();
  assert.deepEqual(await call({ email: "member@example.com", password: replacement }), {
    ok: false,
    limited: false,
  });
});

test("login attempts are atomic, bounded, and recover after their window", async () => {
  await db.prepare("DELETE FROM login_attempts").run();
  const outcomes = await Promise.all(
    Array.from({ length: 12 }, () => call({ email: "missing@example.com", password })),
  );
  assert.equal(outcomes.filter((result) => typeof result === "object" && result.limited).length, 2);
  assert.deepEqual(
    await call({ email: "missing@example.com", password, now: now + 15 * 60 * 1000 }),
    { ok: false, limited: false },
  );
});

test("authentication returns only to safe local pages and rejects cross-origin mutations", () => {
  assert.equal(safeReturnPath("/posts/post?tab=all#reply"), "/posts/post?tab=all#reply");
  for (const path of [
    "//evil.test",
    "/\\evil.test",
    "https://evil.test",
    "/signin-with-chatgpt",
    "/login",
    "/api/auth/logout",
  ])
    assert.equal(safeReturnPath(path), "/");
  assert.equal(
    isSameOriginMutation(
      new Request("https://site.test/api/auth/login", { headers: { Origin: "https://site.test" } }),
    ),
    true,
  );
  for (const origin of ["https://other.site.test", "https://evil.test", "null", ""])
    assert.equal(
      isSameOriginMutation(
        new Request("https://site.test/api/auth/login", { headers: { Origin: origin } }),
      ),
      false,
    );
});
