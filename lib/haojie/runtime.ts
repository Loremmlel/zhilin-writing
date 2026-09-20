import { env } from "cloudflare:workers";
import { measuredDatabase } from "../performance/server";

export function isHaojieEnabled() {
  return env.HAOJIE_ENABLED !== "false";
}

export function getHaojieDb() {
  if (!env.DB) throw new Error("HAOJIE_DATABASE_UNAVAILABLE");
  return measuredDatabase(env.DB);
}
