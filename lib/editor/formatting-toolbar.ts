import type { TopBarFeatureConfig } from "@milkdown/crepe/feature/top-bar";
import type { ToolbarFeatureConfig } from "@milkdown/crepe/feature/toolbar";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyTextFormatting,
  captureFormattingSelection,
  formattingStatus,
} from "./text-formatting-commands.ts";

export type FormattingPanel = {
  key: "size" | "color";
  anchor: HTMLButtonElement;
  container: HTMLElement;
};
type FormatKey = "size" | "color" | "center";
const labels = { size: "字号", color: "文字颜色", center: "居中" };
const chevron =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const icons = {
  size: `<span class="document-format-icon" data-document-format="size"><span data-format-value>字号</span>${chevron}</span>`,
  color: `<span class="document-format-icon" data-document-format="color"><span class="document-format-letter">A<span data-format-swatch></span></span>${chevron}</span>`,
  center:
    '<svg data-document-format="center" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v2H4zm4 5h8v2H8zm-4 5h16v2H4zm4 5h8v2H8z"/></svg>',
};

/** Register through Crepe's public extension hooks; both surfaces call the same commands. */
export function createFormattingToolbarConfig(
  onOpen: (panel: FormattingPanel) => void,
  isDisabled: () => boolean,
) {
  const items = (surface: "top" | "selection") =>
    (["size", "color", "center"] as const).map((key) => ({
      key,
      icon: icons[key],
      label: labels[key],
      active: (ctx: Ctx) => {
        const status = formattingStatus(ctx.get(editorViewCtx).state);
        return key === "center" ? status.center === true : status[key] !== "default";
      },
      onRun: (ctx: Ctx) => {
        const view = ctx.get(editorViewCtx);
        if (isDisabled() || !view.editable || !formattingStatus(view.state).supported) return;
        if (key === "center") {
          applyTextFormatting(view, key, formattingStatus(view.state).center !== true);
          return;
        }
        const container = view.dom.parentElement?.querySelector<HTMLElement>(
          surface === "top" ? ".milkdown-top-bar" : ".milkdown-toolbar",
        );
        const anchor = container
          ?.querySelector(`[data-document-format="${key}"]`)
          ?.closest("button");
        if (!container || !anchor) return;
        captureFormattingSelection(view);
        onOpen({ key, anchor, container });
      },
    }));
  return {
    top: {
      buildTopBar(builder) {
        const group = builder.addGroup("document-format", "正文格式");
        for (const { key, ...item } of items("top")) group.addItem(key, item);
      },
    } satisfies TopBarFeatureConfig,
    selection: {
      buildToolbar(builder) {
        const group = builder.addGroup("document-format", "正文格式");
        for (const { key, ...item } of items("selection")) group.addItem(key, item);
      },
    } satisfies ToolbarFeatureConfig,
  };
}

/** Crepe 7.22 renders pointer actions; add native button keyboard activation and state semantics. */
export function connectFormattingToolbar(view: EditorView, isDisabled: () => boolean) {
  const root = view.dom.parentElement!;
  const buttonFor = (target: EventTarget | null) => {
    const button =
      target instanceof Element
        ? target.closest<HTMLButtonElement>("button[data-document-format-button]")
        : null;
    return button && root.contains(button) ? button : null;
  };
  const keyboardClick = (event: MouseEvent) => {
    const button = buttonFor(event.target);
    if (!button || event.detail !== 0 || button.disabled) return;
    // Dispatch the same public Crepe pointer handler, rather than maintaining a second command map.
    button.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "keyboard" }),
    );
  };
  root.addEventListener("click", keyboardClick);
  let currentPanel: FormattingPanel | null = null;
  const update = (panel: FormattingPanel | null = null) => {
    currentPanel = panel;
    const status = formattingStatus(view.state);
    for (const icon of root.querySelectorAll<HTMLElement>("[data-document-format]")) {
      const key = icon.dataset.documentFormat as FormatKey;
      const button = icon.closest("button");
      if (!button) continue;
      button.dataset.documentFormatButton = key;
      button.disabled = isDisabled() || !view.editable || !status.supported;
      const value =
        key === "center"
          ? status.center === "mixed"
            ? "混合"
            : status.center
              ? "已居中"
              : "未居中"
          : status[key] === "mixed"
            ? "混合"
            : status[key] === "default"
              ? "默认"
              : status[key];
      button.title = button.disabled
        ? "请选择正文段落或表格文字，编辑恢复后可设置格式"
        : `${labels[key]}：${value}`;
      button.setAttribute("aria-label", `${labels[key]}：${value}`);
      if (key === "center") button.setAttribute("aria-pressed", String(status.center));
      else {
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", String(panel?.anchor === button));
      }
      const text = icon.querySelector("[data-format-value]");
      if (text)
        text.textContent =
          status.size === "default" ? "字号" : status.size === "mixed" ? "混合" : status.size;
      const swatch = icon.querySelector<HTMLElement>("[data-format-swatch]");
      if (swatch)
        swatch.style.backgroundColor = /^#[a-f0-9]{6}$/.test(status.color)
          ? status.color
          : "currentColor";
    }
  };
  // The selection toolbar is appended lazily by Crepe's TooltipProvider.
  const mounted = new MutationObserver(() => update(currentPanel));
  mounted.observe(root, { childList: true });
  return {
    update,
    destroy: () => {
      root.removeEventListener("click", keyboardClick);
      mounted.disconnect();
    },
  };
}
