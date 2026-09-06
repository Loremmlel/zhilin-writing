import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { prepareE2EState } from "../e2e/seed.ts";

const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}/`;
const configuredBaseUrl = requireSafeBaseUrl(process.env.E2E_BASE_URL ?? BASE_URL);

const stateDirectory = await mkdtemp(join(tmpdir(), "zhilin-e2e-"));
let server: ChildProcess | undefined;

try {
  await prepareE2EState(stateDirectory);
  const environment = {
    ...process.env,
    E2E_MODE: "1",
    E2E_STATE_DIR: stateDirectory,
    E2E_BASE_URL: configuredBaseUrl,
    WRANGLER_LOG_PATH: resolve(stateDirectory, "wrangler.log"),
  };

  server = spawn(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "--host",
      HOST,
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: resolve("."), env: environment, stdio: "inherit" },
  );
  await waitForServer(environment.E2E_BASE_URL, server);

  const status = await run(
    process.execPath,
    [resolve("node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
    environment,
  );
  process.exitCode = status;
} finally {
  if (server) await stopServer(server);
  await removeOwnedStateDirectory(stateDirectory);
}

function requireSafeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.href !== BASE_URL) {
    throw new Error(`Refusing to start write-capable E2E tests against ${url.origin}`);
  }
  return url.href;
}

async function waitForServer(baseUrl: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null || process.signalCode !== null) {
      throw new Error(`E2E server exited with ${process.exitCode ?? process.signalCode}`);
    }
    try {
      await fetch(baseUrl, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`E2E server did not become ready at ${baseUrl}`);
}

async function run(command: string, arguments_: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<number>((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: resolve("."),
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => server.once("exit", () => resolvePromise()));
  server.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolvePromise) => setTimeout(() => resolvePromise(false), 5_000)),
  ]);
  if (!graceful && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await exited;
  }
}

async function removeOwnedStateDirectory(directory: string): Promise<void> {
  const actual = await realpath(directory);
  const actualTemp = await realpath(tmpdir());
  if (dirname(actual) !== actualTemp || !basename(actual).startsWith("zhilin-e2e-")) {
    throw new Error(`Refusing to remove unowned E2E directory: ${actual}`);
  }
  await rm(actual, { recursive: true, force: true });
}
