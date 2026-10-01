import { randomBytes, scrypt, createHash, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "../domain/rules.ts";
import { passwordError, SESSION_SECONDS } from "./password-policy.ts";

// OWASP's 16 MiB scrypt profile fits the shared 128 MiB Worker isolate.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const PREFIX = "scrypt:16384:8:5";
const DUMMY_HASH = `${PREFIX}:${"0".repeat(32)}:${"0".repeat(64)}`;
const WINDOW_MS = 15 * 60 * 1000;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string) {
  const error = passwordError(password);
  if (error) throw new Error(error);
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `${PREFIX}:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  const valid = stored !== null && /^scrypt:16384:8:5:[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored);
  const parts = (valid ? stored : DUMMY_HASH).split(":");
  const key = await derive(password, parts[4]);
  return timingSafeEqual(key, Buffer.from(parts[5], "hex")) && valid;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Both reset and sign-in use conditional writes, so a concurrent reset/removal
// cannot create a session authenticated with a superseded password.
export async function setMemberPassword(db: D1Database, id: string, password: string) {
  const hash = await hashPassword(password);
  const [result] = await db.batch([
    db
      .prepare(
        `INSERT INTO member_passwords(allowed_user_id,password_hash)
      SELECT id,? FROM allowed_users WHERE id=? AND is_admin=0
      ON CONFLICT(allowed_user_id) DO UPDATE SET password_hash=excluded.password_hash
      RETURNING allowed_user_id`,
      )
      .bind(hash, id),
    db
      .prepare(
        `DELETE FROM member_sessions WHERE allowed_user_id IN
      (SELECT id FROM allowed_users WHERE id=? AND is_admin=0)`,
      )
      .bind(id),
  ]);
  return result.results.length > 0;
}

export async function passwordLogin(
  db: D1Database,
  emailInput: string,
  password: string,
  ip: string,
  now = Date.now(),
) {
  const email = normalizeEmail(emailInput);
  const keys = [hashSessionToken(`email:${email}`), hashSessionToken(`ip:${ip}`)];
  const increment = (key: string) =>
    db
      .prepare(
        `INSERT INTO login_attempts(key,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts`,
      )
      .bind(key, now + WINDOW_MS, now, now);
  const [, , emailAttempts, ipAttempts, credentials] = await db.batch([
    db.prepare("DELETE FROM login_attempts WHERE expires_at<=?").bind(now),
    db.prepare("DELETE FROM member_sessions WHERE expires_at<=?").bind(now),
    increment(keys[0]),
    increment(keys[1]),
    db
      .prepare(
        `SELECT p.allowed_user_id,p.password_hash FROM member_passwords p
      INNER JOIN allowed_users a ON a.id=p.allowed_user_id WHERE a.email=?`,
      )
      .bind(email),
  ]);
  if (
    Number((emailAttempts.results[0] as { attempts: number }).attempts) > 10 ||
    Number((ipAttempts.results[0] as { attempts: number }).attempts) > 60
  )
    return { ok: false as const, limited: true };
  const credential = credentials.results[0] as
    { allowed_user_id: string; password_hash: string } | undefined;
  if (!(await verifyPassword(password, credential?.password_hash ?? null)) || !credential)
    return { ok: false as const, limited: false };
  const token = randomBytes(32).toString("hex");
  const inserted = await db
    .prepare(
      `INSERT INTO member_sessions(token_hash,allowed_user_id,expires_at)
    SELECT ?,p.allowed_user_id,? FROM member_passwords p
    INNER JOIN allowed_users a ON a.id=p.allowed_user_id
    WHERE p.allowed_user_id=? AND p.password_hash=? RETURNING token_hash`,
    )
    .bind(
      hashSessionToken(token),
      now + SESSION_SECONDS * 1000,
      credential.allowed_user_id,
      credential.password_hash,
    )
    .all();
  return inserted.results.length
    ? { ok: true as const, token }
    : { ok: false as const, limited: false };
}
