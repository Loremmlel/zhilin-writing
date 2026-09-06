import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

import { defineConfig } from "@playwright/test";

const baseURL = requireSafeBaseUrl();
requireSafeStateDirectory();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: "outputs/playwright",
  reporter: [["list"], ["html", { open: "never", outputFolder: "outputs/playwright-report" }]],
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    viewport: { width: 1440, height: 1000 },
  },
});

function requireSafeBaseUrl(): string {
  if (process.env.E2E_MODE !== "1") throw new Error("E2E_MODE=1 is required");
  const value = process.env.E2E_BASE_URL;
  if (!value) throw new Error("E2E_BASE_URL is required");
  const url = new URL(value);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "terminal.local"]);
  if (url.protocol !== "http:" || !allowedHosts.has(url.hostname)) {
    throw new Error(`Refusing to run write-capable E2E tests against ${url.origin}`);
  }
  return url.href;
}

function requireSafeStateDirectory(): void {
  const value = process.env.E2E_STATE_DIR;
  if (!value) throw new Error("E2E_STATE_DIR is required");
  const directory = realpathSync(resolve(value));
  const systemTemp = realpathSync(tmpdir());
  if (dirname(directory) !== systemTemp || !basename(directory).startsWith("zhilin-e2e-")) {
    throw new Error(`Refusing non-temporary E2E state directory: ${directory}`);
  }
}
