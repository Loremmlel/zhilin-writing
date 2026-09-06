import { E2E_POSTS } from "./data";
import { expect, test } from "./fixtures";
import { appendToEditor, dropFile, editor, fillEditor, postPath } from "./helpers";

test.describe("帖子写作", () => {
  test("作者发布带标签、正文图片和附件的帖子后可以完整阅读", async ({ openAs }) => {
    const { page } = await openAs("author");
    await page.goto("/posts/new");
    await page.getByLabel("标题").fill("浏览器发布完整帖子");
    await page.getByLabel(/标签/).fill("行为测试，发布旅程");
    await fillEditor(page, "这篇正文由真实浏览器发布。\n\n下面包含一张图片。");
    await dropFile(page, editor(page), "public/og.png", "image/png");
    await page.getByLabel(/^附件/).setInputFiles("public/file.svg");
    await expect(page.getByText("file.svg", { exact: true })).toBeVisible();

    const publish = page.getByRole("button", { name: "发布帖子" });
    let releaseRequest!: () => void;
    let observeRequest!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      observeRequest = resolve;
    });
    const requestReleased = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/posts/new", async (route) => {
      if (route.request().method() === "POST") {
        observeRequest();
        await requestReleased;
      }
      await route.continue();
    });
    const click = publish.click();
    await requestStarted;
    await expect(publish).toBeDisabled();
    releaseRequest();
    await click;
    await expect(page).toHaveURL(/\/posts\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "浏览器发布完整帖子" })).toBeVisible();
    await expect(page.getByText("这篇正文由真实浏览器发布。")).toBeVisible();
    await expect(page.getByRole("link", { name: "行为测试" })).toBeVisible();
    await expect(page.locator('img[src^="/api/assets/"]')).toBeVisible();

    const attachment = page.getByRole("link", { name: /file\.svg/ });
    const downloadEvent = page.waitForEvent("download");
    await attachment.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("file.svg");

    await page.reload();
    await expect(page.getByText("这篇正文由真实浏览器发布。")).toBeVisible();
    await expect(page.getByRole("link", { name: /file\.svg/ })).toBeVisible();
  });

  test("作者编辑帖子后，成员看到新内容和编辑状态", async ({ openAs }) => {
    const author = await openAs("author");
    await author.page.goto(`${postPath(E2E_POSTS.edit.id)}/edit`);
    await expect(editor(author.page)).toContainText("原始正文");
    await author.page.getByLabel("标题").fill("帖子编辑行为已完成");
    await fillEditor(author.page, "这是保存后的新正文，普通成员也应看到。");
    await author.page.getByRole("button", { name: "保存修改" }).click();
    await expect(author.page).toHaveURL(new RegExp(`${postPath(E2E_POSTS.edit.id)}$`));
    await expect(author.page.getByText("编辑于")).toBeVisible();

    const reader = await openAs("reader");
    await reader.page.goto(postPath(E2E_POSTS.edit.id));
    await expect(reader.page.getByRole("heading", { name: "帖子编辑行为已完成" })).toBeVisible();
    await expect(reader.page.getByText("这是保存后的新正文，普通成员也应看到。")).toBeVisible();
    await expect(reader.page.getByText("编辑于")).toBeVisible();
  });

  test("两个页面并发编辑时，不静默覆盖且保留本地内容", async ({ openAs }) => {
    const first = await openAs("author");
    const second = await openAs("author");
    const path = `${postPath(E2E_POSTS.conflict.id)}/edit`;
    await Promise.all([first.page.goto(path), second.page.goto(path)]);
    await appendToEditor(first.page, "\n\n页面 A 的本地修改");
    await appendToEditor(second.page, "\n\n页面 B 已先保存");

    await second.page.getByRole("button", { name: "保存修改" }).click();
    await expect(second.page).toHaveURL(new RegExp(`${postPath(E2E_POSTS.conflict.id)}$`));

    await first.page.getByRole("button", { name: "保存修改" }).click();
    const conflict = first.page.getByRole("alertdialog", { name: "检测到编辑冲突" });
    await expect(conflict).toBeVisible();
    await expect(conflict.getByText("页面 A 的本地修改")).toBeVisible();
    await conflict.getByRole("button", { name: "使用线上版本" }).click();
    await expect(first.page.getByRole("alertdialog", { name: "确认版本选择" })).toContainText(
      "页面 B 已先保存",
    );
    await first.page.getByRole("button", { name: "放弃本地修改" }).click();

    await expect(first.page).toHaveURL(new RegExp(`${postPath(E2E_POSTS.conflict.id)}/edit$`));
    await expect(editor(first.page)).toContainText("页面 B 已先保存");
    await expect(editor(first.page)).not.toContainText("页面 A 的本地修改");
  });
});
