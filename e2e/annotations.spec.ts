import { E2E_ANNOTATIONS, E2E_POSTS } from "./data";
import { expect, test } from "./fixtures";
import {
  confirmAlert,
  dragSelectText,
  editor,
  fillEditor,
  placeCaretInText,
  postPath,
} from "./helpers";

test.describe("正文批注", () => {
  test("同段和连续跨段选区都能创建独立批注", async ({ openAs }) => {
    const { page } = await openAs("reader");
    await page.goto(postPath(E2E_POSTS.annotationCreation.id));

    await dragSelectText(page, "可以创建同段批注的稳定文字");
    await page.getByRole("button", { name: "添加批注" }).click();
    await fillEditor(page, "同段批注内容");
    await page.getByRole("button", { name: "发布批注" }).click();
    await expect(page.getByText("同段批注内容", { exact: true })).toBeVisible();

    await dragSelectText(page, "第二段开始跨段选择", "第三段结束跨段选择");
    await page.getByRole("button", { name: "添加批注" }).click();
    await fillEditor(page, "连续跨段批注内容");
    await page.getByRole("button", { name: "发布批注" }).click();

    await expect(page.getByText("连续跨段批注内容", { exact: true })).toBeVisible();
    await expect(page.getByLabel("正文批注，共 2 条")).toBeVisible();
    await expect(page.getByText("第二段开始跨段选择", { exact: true })).toBeVisible();
    await expect(page.getByText("第三段结束跨段选择", { exact: true })).toBeVisible();
  });

  test("批注只由点击或键盘激活，悬停不自动滚动正文", async ({ openAs }) => {
    const { page } = await openAs("reader");
    await page.goto(postPath(E2E_POSTS.annotationActivation.id));
    const anchor = page.getByText("可以点击的批注文本", { exact: true });
    const before = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));

    await anchor.hover();
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(before);
    await anchor.click();
    await expect(
      page.getByText("这是一条用于验证点击、键盘和响应式阅读的批注。", { exact: true }),
    ).toBeVisible();

    await anchor.focus();
    await anchor.press("Enter");
    await expect(anchor).toBeFocused();
    await expect(page.getByRole("dialog", { name: "正文批注" })).toHaveCount(0);
  });

  test("批注回复通知正确对象，删除后按依赖关系保留讨论", async ({ openAs }) => {
    const author = await openAs("author");
    await author.page.goto(postPath(E2E_POSTS.annotationDiscussion.id));
    const authorThread = author.page.locator(`#annotation-card-${E2E_ANNOTATIONS.discussion}`);
    await authorThread.getByRole("button", { name: "回复批注" }).click();
    await authorThread.locator('[contenteditable="true"]').fill("作者补充的批注回复");
    await authorThread.getByRole("button", { name: "发送回复" }).click();
    await expect(author.page.getByText("作者补充的批注回复", { exact: true })).toBeVisible();

    const reader = await openAs("reader");
    await reader.page.goto(postPath(E2E_POSTS.annotationDiscussion.id));
    const readerThread = reader.page.locator(`#annotation-card-${E2E_ANNOTATIONS.discussion}`);
    const targetReply = readerThread.locator("section").filter({ hasText: "已有的一条批注回复。" });
    await targetReply.getByRole("button", { name: "回复", exact: true }).click();
    await readerThread.locator('[contenteditable="true"]').fill("读者直接回复作者");
    await readerThread.getByRole("button", { name: "发送回复" }).click();
    await expect(reader.page.getByText("读者直接回复作者", { exact: true })).toBeVisible();
    await expect(reader.page.getByText(/回复 测试作者 ·/)).toBeVisible();

    await author.page.goto("/notifications?tab=unread");
    const notice = author.page.getByRole("link").filter({ hasText: "读者直接回复作者" });
    await expect(notice).toContainText("回复了你");
    await notice.click();
    await expect(author.page).toHaveURL(/target=annotation-reply/);
    await expect(author.page.getByText("读者直接回复作者", { exact: true })).toBeVisible();

    await reader.page.goto(postPath(E2E_POSTS.annotationDiscussion.id));
    const ownedThread = reader.page.locator(`#annotation-card-${E2E_ANNOTATIONS.discussion}`);
    await ownedThread.getByRole("button", { name: "删除批注" }).click();
    await confirmAlert(reader.page, "删除这条批注？", "确认删除");
    await expect(reader.page.getByText("该批注已被作者删除。", { exact: true })).toBeVisible();
    await expect(reader.page.getByText("作者补充的批注回复", { exact: true })).toBeVisible();
  });

  test("批注正文内部可直接编辑，破坏端点必须确认", async ({ openAs }) => {
    const author = await openAs("author");
    const editPath = `${postPath(E2E_POSTS.annotationEdit.id)}/edit`;
    await author.page.goto(editPath);
    await placeCaretInText(editor(author.page), "受端点保护的批注文本", 6);
    await author.page.keyboard.insertText("新增");
    await expect(author.page.getByRole("alertdialog", { name: /此修改会撤下/ })).toHaveCount(0);
    await author.page.getByRole("button", { name: "保存修改" }).click();
    await expect(author.page).toHaveURL(new RegExp(`${postPath(E2E_POSTS.annotationEdit.id)}$`));
    await expect(author.page.getByText(/受端点保护.*新增.*批注文本/)).toBeVisible();

    await author.page.goto(editPath);
    const protectedText = "受端点保护的新增批注文本";
    await placeCaretInText(editor(author.page), protectedText, 0);
    await author.page.keyboard.press("Delete");
    const guard = author.page.getByRole("alertdialog", { name: "此修改会撤下这条批注" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "取消" }).click();
    await expect(editor(author.page)).toContainText(protectedText);

    await placeCaretInText(editor(author.page), protectedText, 0);
    await author.page.keyboard.press("Delete");
    await guard.getByRole("button", { name: "继续修改并撤下批注" }).click();
    await expect(
      author.page.getByRole("status").filter({ hasText: "保存后将撤下 1 条批注" }),
    ).toBeVisible();
    await author.page.getByRole("button", { name: "保存修改" }).click();
    await expect(author.page).toHaveURL(new RegExp(`${postPath(E2E_POSTS.annotationEdit.id)}$`));
    await expect(author.page.getByText("受端点保护的新增批注文本", { exact: true })).toHaveCount(0);

    const admin = await openAs("admin");
    await admin.page.goto(
      `/admin/revisions/${E2E_POSTS.annotationEdit.id}?revision=${E2E_POSTS.annotationEdit.revisionId}`,
    );
    await expect(admin.page.getByText("受端点保护的批注文本", { exact: true })).toBeVisible();
    await expect(admin.page.getByText("批注快照").locator("..")).toContainText("1 条");
  });
});
