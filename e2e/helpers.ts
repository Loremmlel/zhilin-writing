import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page } from "@playwright/test";

export function editor(page: Page, index = 0): Locator {
  return page.locator('[contenteditable="true"]').nth(index);
}

export async function fillEditor(page: Page, value: string, index = 0): Promise<void> {
  const target = editor(page, index);
  await expect(target).toBeEditable();
  await target.fill(value);
}

export async function appendToEditor(page: Page, value: string, index = 0): Promise<void> {
  const target = editor(page, index);
  await expect(target).toBeEditable();
  await target.click();
  await target.press("ControlOrMeta+End");
  for (const [index, line] of value.split("\n").entries()) {
    if (index > 0) await target.press("Enter");
    if (line) await target.pressSequentially(line);
  }
}

export async function dragSelectText(
  page: Page,
  startText: string,
  endText = startText,
): Promise<void> {
  const points = await page.locator(".annotation-document-body").evaluate(
    (root, requested) => {
      const locate = (needle: string, atEnd: boolean) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const index = node.data.indexOf(needle);
          if (index < 0) continue;
          const range = document.createRange();
          const from = atEnd ? index + needle.length - 1 : index;
          range.setStart(node, from);
          range.setEnd(node, from + 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + (atEnd ? rect.width : 0), y: rect.top + rect.height / 2 };
        }
        throw new Error(`Unable to find visible text: ${needle}`);
      };
      return {
        start: locate(requested.startText, false),
        end: locate(requested.endText, true),
      };
    },
    { startText, endText },
  );
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "添加批注" })).toBeVisible();
}

export async function dropFile(
  page: Page,
  target: Locator,
  path: string,
  mimeType: string,
): Promise<void> {
  const bytes = await readFile(path);
  const dataTransfer = await page.evaluateHandle(
    ({ base64, filename, type }) => {
      const raw = atob(base64);
      const data = Uint8Array.from(raw, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], filename, { type }));
      return transfer;
    },
    {
      base64: bytes.toString("base64"),
      filename: path.split("/").at(-1) ?? "upload.bin",
      type: mimeType,
    },
  );
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}

export async function placeCaretInText(root: Locator, text: string, offset: number): Promise<void> {
  await root.evaluate(
    (element, requested) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const start = node.data.indexOf(requested.text);
        if (start < 0) continue;
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(node, start + requested.offset);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
        (element as HTMLElement).focus();
        return;
      }
      throw new Error(`Unable to place caret in: ${requested.text}`);
    },
    { text, offset },
  );
}

export async function confirmAlert(
  page: Page,
  title: string | RegExp,
  action: string,
): Promise<void> {
  const dialog = page.getByRole("alertdialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: action, exact: true }).click();
  await expect(dialog).toBeHidden();
}

export function postPath(id: string): string {
  return `/posts/${id}`;
}
