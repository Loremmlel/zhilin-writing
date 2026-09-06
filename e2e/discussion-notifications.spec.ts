import { E2E_POSTS } from "./data";
import { expect, test } from "./fixtures";
import { confirmAlert, fillEditor, postPath } from "./helpers";

test.describe("讨论与通知", () => {
  test("成员回复帖子和另一条回复时保持一层讨论并通知直接对象", async ({ openAs }) => {
    const reader = await openAs("reader");
    await reader.page.goto(postPath(E2E_POSTS.discussion.id));
    await reader.page.getByRole("button", { name: "回复文章" }).click();
    await fillEditor(reader.page, "读者发布的根回复");
    await reader.page.getByRole("button", { name: "写回复" }).click();
    await expect(reader.page.getByText("读者发布的根回复", { exact: true })).toBeVisible();

    const author = await openAs("author");
    await author.page.goto(postPath(E2E_POSTS.discussion.id));
    const rootReply = author.page.locator("article").filter({ hasText: "读者发布的根回复" });
    await rootReply.getByRole("button", { name: "回复", exact: true }).click();
    await rootReply.locator('[contenteditable="true"]').fill("作者回复读者的内容");
    await rootReply.getByRole("button", { name: "回复 测试读者" }).click();
    await expect(author.page.getByText("作者回复读者的内容", { exact: true })).toBeVisible();
    await expect(author.page.getByText("回复 测试读者", { exact: true })).toBeVisible();

    await reader.page.goto("/notifications?tab=unread");
    const notice = reader.page.getByRole("link").filter({ hasText: "作者回复读者的内容" });
    await expect(notice).toContainText("回复了你");
    await notice.click();
    await expect(reader.page).toHaveURL(/target=post-reply/);
    const directReply = reader.page.locator("article").filter({ hasText: "作者回复读者的内容" });
    await expect(directReply).toBeFocused();

    const ownedRoot = reader.page.locator("article").filter({ hasText: "读者发布的根回复" });
    await ownedRoot.getByRole("button", { name: "删除这条回复" }).click();
    await confirmAlert(reader.page, "删除这条回复？", "确认删除");
    await expect(reader.page.getByText("作者回复读者的内容", { exact: true })).toBeVisible();
    await expect(reader.page.getByText(/回复已由作者删除/)).toBeVisible();
  });

  test("提交失败保留回复内容，恢复后重试只发布一次", async ({ openAs }) => {
    const { page } = await openAs("reader");
    await page.goto(postPath(E2E_POSTS.replyFailure.id));
    await page.getByRole("button", { name: "回复文章" }).click();
    await fillEditor(page, "恢复后只能出现一次的回复");

    const admin = await openAs("admin");
    const query = encodeURIComponent(E2E_POSTS.replyFailure.title);
    await admin.page.goto(`/admin?type=posts&status=normal&q=${query}`);
    let row = admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.replyFailure.title) });
    await row.getByRole("button", { name: "隐藏", exact: true }).click();
    await confirmAlert(admin.page, "隐藏这条帖子？", "隐藏");

    await page.getByRole("button", { name: "写回复" }).click();
    await expect(page.getByRole("alert")).toContainText("回复失败，请稍后重试");
    await expect(page.locator('[contenteditable="true"]')).toContainText(
      "恢复后只能出现一次的回复",
    );

    await admin.page.goto(`/admin?type=posts&status=hidden&q=${query}`);
    row = admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.replyFailure.title) });
    await row.getByRole("button", { name: "取消隐藏" }).click();
    await confirmAlert(admin.page, "取消隐藏这条帖子？", "取消隐藏");

    await page.getByRole("button", { name: "写回复" }).click();
    await expect(page.getByText("恢复后只能出现一次的回复", { exact: true })).toHaveCount(1);
  });
});
