import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
let database: SqliteRemoteDatabase;
export function useQueryDatabase(value: SqliteRemoteDatabase) {
  database = value;
}
export function getDb() {
  return database;
}
