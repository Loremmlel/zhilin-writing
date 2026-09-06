import { E2E_POSTS } from "./data";
import { expect, test } from "./fixtures";
import { postPath } from "./helpers";

test.describe("响应式交互", () => {
  test("批注阅读和全局导航在桌面、中间宽度和手机保持同一语义", async ({ openAs }) => {
    const { page } = await openAs("reader", { viewport: { width: 1440, height: 1000 } });
    await page.goto(postPath(E2E_POSTS.annotationActivation.id));
    const anchor = page.getByText("可以点击的批注文本", { exact: true });
    await expect(page.getByLabel("正文批注，共 1 条")).toBeVisible();
    await anchor.click();
    await expect(
      page.getByText("这是一条用于验证点击、键盘和响应式阅读的批注。", { exact: true }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await anchor.click();
    const sheet = page.getByRole("dialog", { name: "正文批注" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("这是一条用于验证点击、键盘和响应式阅读的批注。");
    await sheet.getByRole("button", { name: "关闭" }).click();
    await expect(sheet).toBeHidden();
    await expect(anchor).toBeFocused();

    await page.setViewportSize({ width: 820, height: 900 });
    await expect(page.getByRole("link", { name: "写帖子" })).toBeVisible();
    await expect(page.getByRole("link", { name: "通知" })).toBeVisible();
    await expect(page.getByRole("button", { name: /账户菜单/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /搜索/ }).first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
