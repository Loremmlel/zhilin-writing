import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_PATH = resolve("tests/fixtures/docx/public/manifest.json");
const MAX_FIXTURE_BYTES = 20 * 1024 * 1024;

export async function verifyPublicDocxFixtures(manifestPath = MANIFEST_PATH) {
  const manifest = await loadManifest(manifestPath);
  let verified = 0;
  for (const fixture of manifest.fixtures) {
    if (fixture.status === "unavailable") {
      process.stdout.write(`skipped ${fixture.id}: ${fixture.skipReason}\n`);
      continue;
    }
    const path = resolve(dirname(manifestPath), fixture.filename);
    const bytes = await readFile(path);
    assertHash(fixture, bytes);
    verified += 1;
  }
  process.stdout.write(`verified ${verified} public DOCX fixtures\n`);
}

export async function fetchPublicDocxFixtures(manifestPath = MANIFEST_PATH) {
  const manifest = await loadManifest(manifestPath);
  await mkdir(dirname(manifestPath), { recursive: true });
  for (const fixture of manifest.fixtures) {
    if (fixture.status === "unavailable") {
      process.stdout.write(`skipped ${fixture.id}: ${fixture.skipReason}\n`);
      continue;
    }
    const response = await fetch(fixture.downloadUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${fixture.id}: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_FIXTURE_BYTES) {
      throw new Error(`${fixture.id}: fixture exceeds ${MAX_FIXTURE_BYTES} bytes`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FIXTURE_BYTES) throw new Error(`${fixture.id}: fixture exceeds ${MAX_FIXTURE_BYTES} bytes`);
    assertHash(fixture, bytes);

    const target = resolve(dirname(manifestPath), fixture.filename);
    const temporary = resolve(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    process.stdout.write(`fetched ${fixture.id}\n`);
  }
}

async function loadManifest(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.fixtures)) throw new Error("Unsupported public fixture manifest");
  const ids = new Set();
  const filenames = new Set();
  for (const fixture of manifest.fixtures) {
    if (!fixture?.id || ids.has(fixture.id)) throw new Error("Public fixture IDs must be unique");
    ids.add(fixture.id);
    if (fixture.status === "unavailable") {
      if (!fixture.skipReason) throw new Error(`${fixture.id}: unavailable fixture requires a skip reason`);
      continue;
    }
    if (
      fixture.status !== "available"
      || !fixture.filename
      || basename(fixture.filename) !== fixture.filename
      || filenames.has(fixture.filename)
      || !/^https:\/\//.test(fixture.downloadUrl)
      || !/^[0-9a-f]{64}$/.test(fixture.sha256)
      || !fixture.license
      || !fixture.sourceStatement
      || (fixture.observedProducerEvidence
        ? (!fixture.observedProducerEvidence.part || !fixture.observedProducerEvidence.contains)
        : !fixture.evidenceNote)
    ) throw new Error(`${fixture.id}: incomplete pinned fixture metadata`);
    filenames.add(fixture.filename);
  }
  return manifest;
}

function assertHash(fixture, bytes) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== fixture.sha256) throw new Error(`${fixture.id}: SHA-256 mismatch (expected ${fixture.sha256}, got ${actual})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--verify")) {
    throw new Error("Usage: node scripts/fixtures/fetch-public-docx-fixtures.mjs [--verify]");
  }
  if (process.argv[2] === "--verify") await verifyPublicDocxFixtures();
  else await fetchPublicDocxFixtures();
}
