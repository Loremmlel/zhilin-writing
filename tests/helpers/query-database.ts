import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
let database: SqliteRemoteDatabase | DrizzleD1Database;
export function useQueryDatabase(value: SqliteRemoteDatabase | DrizzleD1Database) {
  database = value;
}
export function getDb() {
  return database;
}
