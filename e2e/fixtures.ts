import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { E2E_USERS } from "./data";

export type E2EIdentity = keyof typeof E2E_USERS;

async function createActor(
  browser: Browser,
  identity: E2EIdentity,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const user = E2E_USERS[identity];
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "oai-authenticated-user-email": user.email,
      "oai-authenticated-user-full-name": encodeURIComponent(user.displayName),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
    viewport: options.viewport ?? { width: 1440, height: 1000 },
  });
  return { context, page: await context.newPage() };
}

export const test = base.extend<{
  openAs: (
    identity: E2EIdentity,
    options?: { viewport?: { width: number; height: number } },
  ) => Promise<{ context: BrowserContext; page: Page }>;
}>({
  openAs: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (identity, options) => {
      const actor = await createActor(browser, identity, options);
      contexts.push(actor.context);
      return actor;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };

export async function expectPageReady(page: Page): Promise<void> {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByText("页面暂时无法显示")).toHaveCount(0);
}
