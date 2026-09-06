import { E2E_DISCOVERY_POSTS, E2E_TAG } from "./data";
import { expect, test } from "./fixtures";

test.describe("发现内容", () => {
  test("搜索、标签、排序和分页由 URL 表达并可由浏览器返回恢复", async ({ openAs }) => {
    const { page } = await openAs("reader");
    await page.goto("/");
    await page.getByRole("link", { name: "最近活跃" }).click();
    await expect(page).toHaveURL(/sort=active/);
    await page.getByRole("link", { name: "下一页" }).click();
    await expect(page).toHaveURL(/sort=active.*page=2|page=2.*sort=active/);

    await page.getByLabel("搜索帖子标题或正文").first().fill("分页检索");
    await page.getByRole("button", { name: "提交搜索" }).first().click();
    await expect(page).toHaveURL(/\/search\?q=/);
    await page.getByRole("link", { name: "下一页" }).click();
    await expect(page).toHaveURL(/q=.*page=2|page=2.*q=/);
    await page.getByRole("link", { name: E2E_DISCOVERY_POSTS.at(-1)!.title }).click();
    await expect(
      page.getByRole("heading", { name: E2E_DISCOVERY_POSTS.at(-1)!.title }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?.*page=2/);
    await expect(page.getByLabel("搜索帖子标题或正文").first()).toHaveValue("分页检索");

    await page.goto(`/tags/${encodeURIComponent(E2E_TAG.normalizedName)}`);
    await expect(page.getByRole("heading", { name: E2E_TAG.name })).toBeVisible();
    await expect(page.getByLabel("标签帖子")).toContainText(E2E_DISCOVERY_POSTS[0].title);
    await expect(page.getByLabel("标签帖子")).not.toContainText(E2E_POST_TITLE_WITHOUT_TAG);
  });
});

const E2E_POST_TITLE_WITHOUT_TAG = "讨论行为测试";
