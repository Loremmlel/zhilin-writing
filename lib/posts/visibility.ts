import { sql } from "drizzle-orm";
import { posts } from "../../db/schema.ts";

export class PostVisibilityError extends Error {}

export function parsePostVisibility(value: unknown): string[] | null {
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length > 500 ||
    value.some((id) => typeof id !== "string" || !id || id.length > 128)
  )
    throw new PostVisibilityError("可见用户设置无效，请重新选择");
  return [...new Set(value as string[])].sort();
}

export function parsePostVisibilityField(value: FormDataEntryValue | null) {
  if (value === null) return undefined; // Older open editors preserve the current scope.
  try {
    return parsePostVisibility(JSON.parse(String(value)));
  } catch {
    throw new PostVisibilityError("可见用户设置无效，请重新选择");
  }
}

// Evaluated with the authenticated viewer ID, never a client-supplied role.
export function postVisibilityCondition(viewerId: string) {
  return sql`exists (select 1 from users visibility_viewer
    inner join allowed_users visibility_access on visibility_access.email = visibility_viewer.email_key
    where visibility_viewer.id = ${viewerId} and
      (visibility_access.is_admin = 1 or (visibility_access.permission_group = 'normal' and
        (${posts.visibilityUserIds} is null
          or exists (select 1 from json_each(${posts.visibilityUserIds}) where value = ${viewerId})))))`;
}
