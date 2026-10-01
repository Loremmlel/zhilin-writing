import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { allowedUsers, memberSessions, users } from "@/db/schema";
import { hashSessionToken } from "./password-service";
import { SESSION_COOKIE } from "./password-policy";

export async function readPasswordAccess(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const [row] = await getDb()
    .select({ allowed: allowedUsers, member: users })
    .from(memberSessions)
    .innerJoin(allowedUsers, eq(memberSessions.allowedUserId, allowedUsers.id))
    .leftJoin(users, eq(users.emailKey, allowedUsers.email))
    .where(
      and(
        eq(memberSessions.tokenHash, hashSessionToken(token)),
        gt(memberSessions.expiresAt, Date.now()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const emailKey = row.allowed.email;
  return { ...row, emailKey, identity: { email: emailKey, displayName: emailKey, fullName: null } };
}

export async function passwordSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
