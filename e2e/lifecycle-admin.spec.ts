import { E2E_POSTS } from "./data";
import { expect, test } from "./fixtures";
import { confirmAlert, postPath } from "./helpers";

test.describe("内容生命周期与管理", () => {
  test("作者删除帖子后保留必要讨论，管理员恢复后正文重新可见", async ({ openAs }) => {
    const author = await openAs("author");
    await author.page.goto(postPath(E2E_POSTS.deleteRestore.id));
    await author.page.getByRole("button", { name: "删除帖子" }).click();
    await confirmAlert(author.page, "删除这篇帖子？", "确认删除");
    await expect(author.page.getByRole("heading", { name: "已删除帖子" })).toBeVisible();
    await expect(author.page.getByText("该帖子已被作者删除。", { exact: true })).toBeVisible();
    await expect(
      author.page.getByText("帖子删除后仍然保留的其他成员讨论。", { exact: true }),
    ).toBeVisible();
    await expect(author.page.getByText(/作者删除后这段正文不得泄露/)).toHaveCount(0);

    const admin = await openAs("admin");
    await admin.page.goto(
      `/admin?type=posts&status=deleted&q=${encodeURIComponent(E2E_POSTS.deleteRestore.title)}`,
    );
    const row = admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.deleteRestore.title) });
    await row.getByRole("button", { name: "恢复", exact: true }).click();
    await confirmAlert(admin.page, "恢复这条帖子？", "恢复");

    const reader = await openAs("reader");
    await reader.page.goto(postPath(E2E_POSTS.deleteRestore.id));
    await expect(
      reader.page.getByRole("heading", { name: E2E_POSTS.deleteRestore.title }),
    ).toBeVisible();
    await expect(
      reader.page.getByText("作者删除后这段正文不得泄露，但其他成员的讨论应保留。", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("管理员可通过筛选执行隐藏、恢复、批量操作和永久删除", async ({ openAs }) => {
    const admin = await openAs("admin");
    await admin.page.goto(
      `/admin?type=posts&status=hidden&q=${encodeURIComponent(E2E_POSTS.hidden.title)}`,
    );
    let row = admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.hidden.title) });
    await expect(row).toContainText("管理员已隐藏");
    await row.getByRole("button", { name: "取消隐藏" }).click();
    await confirmAlert(admin.page, "取消隐藏这条帖子？", "取消隐藏");

    await admin.page.goto(
      `/admin?type=posts&status=normal&q=${encodeURIComponent(E2E_POSTS.hidden.title)}`,
    );
    row = admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.hidden.title) });
    await row.getByRole("button", { name: "隐藏", exact: true }).click();
    const hideDialog = admin.page.getByRole("alertdialog", { name: "隐藏这条帖子？" });
    await hideDialog.getByLabel("原因（可选）").fill("行为测试隐藏原因");
    await hideDialog.getByRole("button", { name: "隐藏", exact: true }).click();
    await expect(hideDialog).toBeHidden();
    await admin.page.goto(
      `/admin?type=posts&status=hidden&q=${encodeURIComponent(E2E_POSTS.hidden.title)}`,
    );
    await expect(
      admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.hidden.title) }),
    ).toContainText("行为测试隐藏原因");

    await admin.page.goto("/admin?type=posts&status=normal&q=批量管理目标");
    await admin.page.getByLabel("选择当前页全部内容").check();
    await expect(admin.page.getByText("已选 2 条（仅当前页）")).toBeVisible();
    await admin.page.getByRole("button", { name: "批量隐藏" }).click();
    await confirmAlert(admin.page, "隐藏所选帖子？", "隐藏所选");
    await expect(admin.page.getByText("已处理 2 条，跳过 0 条。")).toBeVisible();

    await admin.page.goto(
      `/admin?type=posts&status=normal&q=${encodeURIComponent(E2E_POSTS.purge.title)}`,
    );
    row = admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.purge.title) });
    await row.getByRole("button", { name: "永久删除" }).click();
    await confirmAlert(admin.page, "永久删除这条帖子？", "永久删除");
    await expect(
      admin.page.getByRole("row", { name: new RegExp(E2E_POSTS.purge.title) }),
    ).toHaveCount(0);

    const reader = await openAs("reader");
    await reader.page.goto(postPath(E2E_POSTS.purge.id));
    await expect(reader.page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  });

  test("管理员恢复历史版本时生成新版本并恢复完整状态", async ({ openAs }) => {
    const admin = await openAs("admin");
    await admin.page.goto(
      `/admin/revisions/${E2E_POSTS.revision.id}?revision=${E2E_POSTS.revision.revisionId}`,
    );
    await expect(admin.page.getByText("历史版本正文。", { exact: true })).toBeVisible();
    await admin.page.getByRole("button", { name: "恢复此版本" }).click();
    await confirmAlert(admin.page, "恢复 v1？", "确认恢复");
    await expect(admin.page).toHaveURL(/restored=1/);
    await expect(admin.page.getByRole("status")).toContainText("历史版本已复制为新的当前版本");
    await expect(admin.page.getByLabel("Post revisions")).toContainText("3 个");
    await expect(admin.page.getByLabel("Post revisions")).toContainText("恢复自 v1");

    const reader = await openAs("reader");
    await reader.page.goto(postPath(E2E_POSTS.revision.id));
    await expect(reader.page.getByText("历史版本正文。", { exact: true })).toBeVisible();
    await expect(reader.page.getByText("当前版本正文。", { exact: true })).toHaveCount(0);
  });
});
