import { sql, type SQLWrapper } from "drizzle-orm";

// External ID lists use one bound value; prefer JOIN/subqueries for database-owned relations.
export function inIdList(column: SQLWrapper, ids: readonly string[]) {
  return sql`${column} in (select value from json_each(${JSON.stringify(ids)}))`;
}
