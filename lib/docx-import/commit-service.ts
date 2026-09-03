import {
  type CommitAssetContext,
  type D1StatementPlan,
  type SqlValue,
  D1_MAX_BOUND_PARAMETERS,
  DocxImportValidationError,
  planDocxImportCommit,
  validateDocxImportCommitPayload,
} from "./commit-plan.ts";

export type { D1StatementPlan } from "./commit-plan.ts";

export type DocxImportCommitDatabase = {
  first<T>(sql: string, params: readonly SqlValue[]): Promise<T | null>;
  all<T>(sql: string, params: readonly SqlValue[]): Promise<T[]>;
  batch(statements: readonly D1StatementPlan[]): Promise<void>;
};

export class DocxImportCommitError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400, options?: ErrorOptions) {
    super(code, options);
    this.name = "DocxImportCommitError";
    this.code = code;
    this.status = status;
  }
}

type ExistingBatch = {
  importerUserId: string;
  sourceFilename: string;
  sourceSha256: string;
  postId: string;
  revisionId: string;
  metadataJson: string | null;
};

type AssetRow = CommitAssetContext & {
  filename: string;
  byteSize: number;
};

export async function commitDocxImport(
  importerUserId: string,
  input: unknown,
  database?: DocxImportCommitDatabase,
): Promise<{ postId: string; revisionId: string; alreadyCommitted: boolean }> {
  const db = database ?? await runtimeDatabase();
  let validated;
  try { validated = validateDocxImportCommitPayload(input); }
  catch (error) {
    if (error instanceof DocxImportValidationError) throw new DocxImportCommitError(error.code, 400, { cause: error });
    throw error;
  }
  const payloadHash = await sha256(stableJson(validated));
  const importer = await loadImporterProfile(db, importerUserId);
  if (!importer) throw new DocxImportCommitError("ACCESS_REVOKED", 403);

  const existing = await findExistingBatch(db, validated.importBatchId);
  if (existing) return assertMatchingBatch(existing, importerUserId, validated.source.filename, validated.source.sha256, payloadHash);

  if (validated.attributedUserIds.length > 0) {
    const allowed = await allowedMemberIds(db, validated.attributedUserIds);
    if (allowed.size !== validated.attributedUserIds.length) throw new DocxImportCommitError("ATTRIBUTED_USER_INVALID", 400);
  }
  const assets = await loadAssets(db, validated.assetIds);
  assertClaimableAssets(validated, importerUserId, assets);

  const postId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const eventId = `activity:post:${postId}:created`;
  const plan = planDocxImportCommit(validated, {
    importerUserId,
    importerDisplayName: importer.displayName,
    postId,
    revisionId,
    eventId,
    payloadHash,
    now: new Date(),
    assets,
  });
  try {
    await db.batch(plan.statements);
  } catch (error) {
    const repeated = await findExistingBatch(db, validated.importBatchId);
    if (repeated) return assertMatchingBatch(repeated, importerUserId, validated.source.filename, validated.source.sha256, payloadHash);
    throw new DocxImportCommitError("IMPORT_COMMIT_FAILED", 500, { cause: error });
  }
  return { postId, revisionId, alreadyCommitted: false };
}

async function runtimeDatabase(): Promise<DocxImportCommitDatabase> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new DocxImportCommitError("DATABASE_UNAVAILABLE", 503);
  return {
    async first<T>(sql: string, params: readonly SqlValue[]) {
      return await env.DB.prepare(sql).bind(...params).first<T>();
    },
    async all<T>(sql: string, params: readonly SqlValue[]) {
      return (await env.DB.prepare(sql).bind(...params).all<T>()).results;
    },
    async batch(statements) {
      await env.DB.batch(statements.map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
    },
  };
}

async function loadImporterProfile(db: DocxImportCommitDatabase, userId: string): Promise<{ displayName: string } | null> {
  return db.first<{ displayName: string }>(
    "SELECT u.display_name AS displayName FROM users u INNER JOIN allowed_users au ON au.email = u.email_key WHERE u.id = ? LIMIT 1",
    [userId],
  );
}

async function allowedMemberIds(db: DocxImportCommitDatabase, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await allByIds<{ id: string }>(db, ids, (placeholders) => (
    `SELECT u.id AS id FROM users u INNER JOIN allowed_users au ON au.email = u.email_key WHERE u.id IN (${placeholders})`
  ));
  return new Set(rows.map((row) => row.id));
}

async function loadAssets(db: DocxImportCommitDatabase, ids: string[]): Promise<AssetRow[]> {
  if (ids.length === 0) return [];
  return allByIds<AssetRow>(db, ids, (placeholders) => (
    `SELECT id, owner_id AS ownerId, kind, filename, mime_type AS mimeType, byte_size AS byteSize, status, deleted_at AS deletedAt, gc_claimed_at AS gcClaimedAt FROM assets WHERE id IN (${placeholders})`
  ));
}

async function allByIds<T>(
  db: DocxImportCommitDatabase,
  ids: string[],
  sql: (placeholders: string) => string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += D1_MAX_BOUND_PARAMETERS) {
    const chunk = ids.slice(index, index + D1_MAX_BOUND_PARAMETERS);
    rows.push(...await db.all<T>(sql(chunk.map(() => "?").join(", ")), chunk));
  }
  return rows;
}

function assertClaimableAssets(
  validated: ReturnType<typeof validateDocxImportCommitPayload>,
  importerUserId: string,
  assets: AssetRow[],
) {
  if (assets.length !== validated.assetIds.length) throw new DocxImportCommitError("ASSET_NOT_CLAIMABLE", 400);
  const rows = new Map(assets.map((asset) => [asset.id, asset]));
  for (const manifest of validated.temporaryAssets) {
    const asset = rows.get(manifest.assetId);
    if (
      !asset
      || asset.ownerId !== importerUserId
      || asset.kind !== "image"
      || asset.status !== "temporary"
      || asset.deletedAt !== null
      || asset.gcClaimedAt != null
      || asset.mimeType !== manifest.mimeType
      || asset.filename !== manifest.filename
      || asset.byteSize <= 0
      || asset.byteSize > 10 * 1024 * 1024
    ) throw new DocxImportCommitError("ASSET_NOT_CLAIMABLE", 400);
  }
}

async function findExistingBatch(db: DocxImportCommitDatabase, batchId: string): Promise<ExistingBatch | null> {
  return db.first<ExistingBatch>(
    `SELECT ib.importer_user_id AS importerUserId, ib.source_filename AS sourceFilename,
      ib.source_sha256 AS sourceSha256, ib.post_id AS postId, ib.revision_id AS revisionId,
      ae.metadata_json AS metadataJson
    FROM import_batches ib
    LEFT JOIN activity_events ae ON ae.post_id = ib.post_id AND ae.event_type = 'POST_CREATED'
    WHERE ib.id = ? LIMIT 1`,
    [batchId],
  );
}

function assertMatchingBatch(
  existing: ExistingBatch,
  importerUserId: string,
  sourceFilename: string,
  sourceSha256: string,
  payloadHash: string,
) {
  let storedHash: string | null = null;
  try {
    const metadata = existing.metadataJson ? JSON.parse(existing.metadataJson) as { docxImportPayloadHash?: unknown } : null;
    storedHash = typeof metadata?.docxImportPayloadHash === "string" ? metadata.docxImportPayloadHash : null;
  } catch {
    storedHash = null;
  }
  if (
    existing.importerUserId !== importerUserId
    || existing.sourceFilename !== sourceFilename
    || existing.sourceSha256 !== sourceSha256
    || storedHash !== payloadHash
  ) throw new DocxImportCommitError("IMPORT_BATCH_CONFLICT", 409);
  return { postId: existing.postId, revisionId: existing.revisionId, alreadyCommitted: true };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
