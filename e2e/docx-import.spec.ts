import { E2E_POSTS } from "./data";
import { expect, test } from "./fixtures";
import { appendToEditor, editor, postPath } from "./helpers";

const DOCX_FIXTURE = "tests/fixtures/docx/manual/cross-block-annotation.docx";

test.describe("DOCX 导入", () => {
  test("真实 DOCX 可以生成可恢复预览并导入为完整帖子", async ({ openAs }) => {
    const { page } = await openAs("author");
    await page.goto("/posts/import");
    await page.getByLabel("选择 DOCX 文件").setInputFiles(DOCX_FIXTURE);
    await expect(page.getByRole("heading", { name: "检查并导入" })).toBeVisible();
    await expect(page.getByLabel("帖子标题")).toHaveValue(/怀念逝去的青春/);
    await expect(page.getByText("Word 批注", { exact: true })).toBeVisible();
    await expect(page.getByText("预览就绪，可以保存")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "继续未完成的导入" })).toBeVisible();
    await page.getByRole("button", { name: "继续预览" }).click();
    await expect(page.getByRole("heading", { name: "检查并导入" })).toBeVisible();
    await page.getByRole("button", { name: "确认导入" }).click();

    await expect(page).toHaveURL(/\/posts\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: /怀念逝去的青春/ })).toBeVisible();
    await expect(page.getByText(/站在.*三十岁.*路口回头望/)).toBeVisible();
    await expect(page.getByLabel(/正文批注，共 [1-9]\d* 条/)).toBeVisible();
  });

  test("导入帖子可以继续编辑，保存后正文和批注保持完整", async ({ openAs }) => {
    const { page } = await openAs("author");
    await page.goto(`${postPath(E2E_POSTS.imported.id)}/edit`);
    await expect(editor(page)).toContainText("导入正文保留普通段落");
    await appendToEditor(page, "\n\n浏览器追加的普通正文。");
    await page.getByRole("button", { name: "保存修改" }).click();

    await expect(page).toHaveURL(new RegExp(`${postPath(E2E_POSTS.imported.id)}$`));
    await expect(page.getByText("浏览器追加的普通正文。", { exact: true })).toBeVisible();
    await expect(page.getByText("导入批注范围", { exact: true })).toBeVisible();
    await expect(page.getByText("Word 中的批注内容。", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText("浏览器追加的普通正文。", { exact: true })).toBeVisible();
    await expect(page.getByText("Word 中的批注内容。", { exact: true })).toBeVisible();
  });
});
