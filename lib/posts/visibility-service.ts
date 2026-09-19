import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { allowedUsers, posts, users } from "@/db/schema";
import { parsePostVisibility, PostVisibilityError, postVisibilityCondition } from "./visibility";

export async function listPostVisibilityUsers() {
  return getDb()
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .innerJoin(allowedUsers, eq(users.emailKey, allowedUsers.email))
    .where(eq(allowedUsers.isAdmin, false))
    .orderBy(users.displayName);
}

export async function normalizePostVisibility(value: unknown, authorId: string) {
  const ids = parsePostVisibility(value);
  if (ids === null) return null;
  const candidates = await listPostVisibilityUsers();
  const valid = new Set(candidates.map((user) => user.id));
  if (ids.some((id) => id !== authorId && !valid.has(id)))
    throw new PostVisibilityError("部分用户已不可选，请刷新页面后重新设置可见范围");
  return [
    ...new Set([...ids.filter((id) => valid.has(id)), ...(valid.has(authorId) ? [authorId] : [])]),
  ].sort();
}

export async function canViewPost(postId: string, viewerId: string) {
  const rows = await getDb()
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), postVisibilityCondition(viewerId)))
    .limit(1);
  return rows.length > 0;
}
