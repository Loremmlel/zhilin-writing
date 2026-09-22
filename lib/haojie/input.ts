import { z } from "zod";
import { parseCommand, RuleError } from "../../vendor/haojie2/src/engine/index";
import { HaojieError, type MutationInput } from "./contracts.ts";
import { HAOJIE_EMOJIS, REACTION_BATCH_SIZE } from "./reactions.ts";

const reactionSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            emoji: z.enum(HAOJIE_EMOJIS.map(([emoji]) => emoji)),
          })
          .strict(),
      )
      .min(1)
      .max(REACTION_BATCH_SIZE),
  })
  .strict();

export function parseReaction(input: unknown) {
  const parsed = reactionSchema.safeParse(input);
  if (
    !parsed.success ||
    new Set(parsed.data.items.map((item) => item.id)).size !== parsed.data.items.length
  )
    throw new HaojieError("INVALID_REQUEST", 400, "请选择列表中的表情。");
  return parsed.data;
}

const envelope = {
  requestId: z.uuid(),
  engineVersion: z.string().regex(/^[0-9a-f]{40}$/),
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};
const createSchema = z
  .object({ requestId: z.uuid(), mode: z.enum(["classic", "shrine"]) })
  .strict();
const joinSchema = z.object(envelope).strict();
const commandSchema = z.object({ ...envelope, command: z.unknown() }).strict();
const finishSchema = z.object({ ...envelope, kind: z.enum(["cancel", "resign"]) }).strict();
const undoSchema = z.discriminatedUnion("kind", [
  z.object({ ...envelope, kind: z.literal("undo-request") }).strict(),
  z
    .object({
      ...envelope,
      kind: z.enum(["undo-accept", "undo-reject", "undo-cancel"]),
      undoId: z.uuid(),
    })
    .strict(),
]);

export function parseRoomId(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new HaojieError("ROOM_UNAVAILABLE", 404, "房间不存在或无法访问。");
  return id;
}

export function parseAfter(value: string | null): number {
  if (value === null) return -1;
  if (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new HaojieError("INVALID_REQUEST", 400, "同步请求格式无效，请刷新页面。");
  return Number(value);
}

export async function readRoomBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HaojieError("ORIGIN_REJECTED", 403, "请从本站页面进行操作。");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    throw new HaojieError("INVALID_REQUEST", 415, "请求必须使用 JSON 格式。");
  const limit = 16 * 1024;
  const tooLarge = () => new HaojieError("BODY_TOO_LARGE", 413, "操作请求过大。");
  if (Number(request.headers.get("content-length")) > limit) throw tooLarge();
  if (!request.body) throw new HaojieError("INVALID_REQUEST", 400, "操作请求为空。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HaojieError("INVALID_REQUEST", 400, "操作请求格式无效。");
  }
}

export function parseCreate(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new HaojieError("INVALID_REQUEST", 400, "请选择有效的对局模式。");
  return parsed.data;
}

export function parseMutation(
  kind: "join" | "command" | "finish" | "undo",
  input: unknown,
): MutationInput {
  if (kind === "command") {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new HaojieError("INVALID_REQUEST", 400, "操作请求格式无效。");
    try {
      return { ...parsed.data, kind, command: parseCommand(parsed.data.command) };
    } catch (error) {
      if (error instanceof RuleError) throw new HaojieError("COMMAND_REJECTED", 422, error.message);
      throw error;
    }
  }
  const parsed = (
    kind === "join" ? joinSchema : kind === "undo" ? undoSchema : finishSchema
  ).safeParse(input);
  if (!parsed.success) throw new HaojieError("INVALID_REQUEST", 400, "操作请求格式无效。");
  return (kind === "join" ? { ...parsed.data, kind } : parsed.data) as MutationInput;
}
