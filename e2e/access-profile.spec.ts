import { E2E_USERS } from "./data";
import { expect, test } from "./fixtures";
import { expectPageReady } from "./fixtures";

test.describe("访问与个人资料", () => {
  test("管理员邀请后，新成员完成首次资料并进入社区", async ({ openAs }) => {
    const outsider = await openAs("outsider");
    await outsider.page.goto("/");
    await expect(
      outsider.page.getByRole("heading", { name: "这个写作社区暂未向你开放" }),
    ).toBeVisible();

    const admin = await openAs("admin");
    await admin.page.goto("/admin?section=members");
    await admin.page.getByLabel("邮箱地址").fill(E2E_USERS.outsider.email);
    await admin.page.getByRole("button", { name: "加入白名单" }).click();
    await expect(
      admin.page.getByRole("row", { name: new RegExp(E2E_USERS.outsider.email) }),
    ).toContainText("尚未注册");

    await outsider.page.goto("/");
    await expect(outsider.page).toHaveURL(/\/onboarding/);
    await outsider.page.getByLabel("显示名称").fill("受邀新成员");
    await outsider.page.getByLabel("个人简介（可选）").fill("通过邀请加入的测试成员");
    await outsider.page.getByRole("button", { name: "进入社区" }).click();
    await expect(outsider.page).toHaveURL(/\/$/);
    await expectPageReady(outsider.page);
    await expect(outsider.page.getByRole("button", { name: "账户菜单，受邀新成员" })).toBeVisible();
  });

  test("成员修改资料和头像后，刷新仍显示新资料", async ({ openAs }) => {
    const { page } = await openAs("admin");
    await page.goto("/settings/profile");
    await page.getByLabel("显示名称").fill("管理员新名");
    await page.getByLabel("个人简介").fill("刷新后仍然存在的新简介");
    await page.getByLabel("更换头像").setInputFiles("public/og.png");
    await page.getByRole("button", { name: "保存资料" }).click();

    await expect(page).toHaveURL(new RegExp(`/users/${E2E_USERS.admin.id}$`));
    await expect(page.getByRole("heading", { name: "管理员新名" })).toBeVisible();
    await expect(page.getByText("刷新后仍然存在的新简介")).toBeVisible();
    await expect(page.getByRole("img", { name: "管理员新名的头像" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "账户菜单，管理员新名" })).toBeVisible();
    await expect(page.getByRole("img", { name: "管理员新名的头像" }).first()).toBeVisible();
  });
});
