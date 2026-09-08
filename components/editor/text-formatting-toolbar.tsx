"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyTextFormatting,
  captureFormattingSelection,
  formattingSelectionKey,
  formattingStatus,
  releaseFormattingSelection,
} from "@/lib/editor/text-formatting-commands";
import { connectFormattingToolbar, type FormattingPanel } from "@/lib/editor/formatting-toolbar";
import { fontSize, textColor } from "@/lib/markdown/formatting";

const sizes = [10.5, 12, 14, 16, 18, 24, 36];
const colors = [
  ["#242d27", "墨黑"],
  ["#c00000", "红色"],
  ["#386647", "绿色"],
  ["#2457a7", "蓝色"],
  ["#7030a0", "紫色"],
  ["#75591f", "棕色"],
];

export function TextFormattingToolbar({
  view,
  panel,
  disabled,
  onClose,
}: {
  view: EditorView;
  panel: FormattingPanel | null;
  disabled: boolean;
  onClose: () => void;
}) {
  const disabledRef = useRef(disabled);
  const connection = useRef<ReturnType<typeof connectFormattingToolbar> | null>(null);
  useLayoutEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  useLayoutEffect(() => {
    connection.current = connectFormattingToolbar(view, () => disabledRef.current);
    return () => {
      connection.current?.destroy();
      connection.current = null;
    };
  }, [view]);
  useLayoutEffect(() => {
    connection.current?.update(panel);
  });
  if (!panel) return null;
  return (
    <FormattingPopover
      key={`${panel.container.className}-${panel.key}`}
      view={view}
      panel={panel}
      disabled={disabled}
      onClose={onClose}
    />
  );
}

function FormattingPopover({
  view,
  panel,
  disabled,
  onClose,
}: {
  view: EditorView;
  panel: FormattingPanel;
  disabled: boolean;
  onClose: () => void;
}) {
  const status = formattingStatus(view.state);
  const current = status[panel.key];
  const [draft, setDraft] = useState(() =>
    panel.key === "size"
      ? fontSize(current) === undefined
        ? "12"
        : current
      : (textColor(current) ?? "#242d27"),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const closing = useRef(false);
  const id = useId();
  const blocked = disabled || !view.editable || !status.supported;
  const value = panel.key === "size" ? fontSize(draft) : textColor(draft);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const { anchor, container } = panel;
    closing.current = false;
    captureFormattingSelection(view);
    const close = (restoreFocus: boolean) => {
      if (closing.current) return;
      closing.current = true;
      if (restoreFocus && anchor.isConnected && !anchor.disabled) anchor.focus();
      closeRef.current();
    };
    root.showPopover?.();
    const position = () => {
      if (!anchor.isConnected || container.dataset.show === "false") {
        close(false);
        return;
      }
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0,
        top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth,
        height = viewport?.height ?? window.innerHeight;
      root.style.maxHeight = `${Math.max(80, height - 16)}px`;
      root.style.maxWidth = `${Math.max(80, width - 16)}px`;
      const rect = anchor.getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      const y =
        rect.bottom + 6 + bounds.height <= top + height - 8
          ? rect.bottom + 6
          : rect.top - bounds.height - 6;
      root.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - bounds.width - 8))}px`;
      root.style.top = `${Math.max(top + 8, Math.min(y, top + height - bounds.height - 8))}px`;
    };
    position();
    (
      root.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? root.querySelector("button")
    )?.focus();
    anchor.setAttribute("aria-controls", id);
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !root.contains(event.target) &&
        !anchor.contains(event.target)
      )
        close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    root.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const resize = new ResizeObserver(position);
    resize.observe(root);
    resize.observe(anchor);
    const visibility = new MutationObserver(position);
    visibility.observe(container, { attributes: true, attributeFilter: ["data-show"] });
    return () => {
      root.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      resize.disconnect();
      visibility.disconnect();
      anchor.removeAttribute("aria-controls");
      if (!view.isDestroyed && formattingSelectionKey.getState(view.state))
        releaseFormattingSelection(view);
    };
  }, [view, panel, id]);
  useEffect(() => {
    if (blocked) closeRef.current();
  }, [blocked]);

  const cancel = () => {
    closing.current = true;
    if (!panel.anchor.disabled) panel.anchor.focus();
    onClose();
  };
  const apply = (next: number | string | null) => {
    if (blocked) return;
    closing.current = true;
    applyTextFormatting(view, panel.key, next);
    onClose();
  };
  return createPortal(
    <div
      ref={rootRef}
      id={id}
      popover="manual"
      className="document-format-popover"
      role="dialog"
      aria-label={panel.key === "size" ? "字号" : "文字颜色"}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.stopPropagation();
        if (event.target instanceof HTMLInputElement && event.target.type !== "color") {
          event.preventDefault();
          if (!event.nativeEvent.isComposing && value !== undefined) apply(value);
        }
      }}
    >
      <div className="document-format-heading">
        <strong>{panel.key === "size" ? "字号" : "文字颜色"}</strong>
        <span>
          当前：
          {current === "default"
            ? "默认"
            : current === "mixed"
              ? "混合"
              : `${current}${panel.key === "size" ? " 磅" : ""}`}
        </span>
      </div>
      <div className={panel.key === "size" ? "document-size-presets" : "document-color-presets"}>
        {panel.key === "size"
          ? sizes.map((size) => (
              <button
                key={size}
                type="button"
                disabled={blocked}
                aria-pressed={current === String(size)}
                onClick={() => apply(size)}
              >
                {size}
              </button>
            ))
          : colors.map(([color, label]) => (
              <button
                key={color}
                type="button"
                disabled={blocked}
                aria-label={`${label} ${color}`}
                title={`${label} ${color}`}
                aria-pressed={current === color}
                onClick={() => apply(color!)}
              >
                <span style={{ backgroundColor: color }} />
                {label}
              </button>
            ))}
        <button
          type="button"
          disabled={blocked}
          aria-pressed={current === "default"}
          onClick={() => apply(null)}
        >
          默认
        </button>
      </div>
      <div className="document-format-custom">
        <label htmlFor={`${id}-value`}>
          {panel.key === "size" ? "自定义字号（磅）" : "自定义颜色（HEX）"}
        </label>
        <div className="document-format-input-row">
          {panel.key === "color" && (
            <input
              type="color"
              aria-label="选择颜色"
              disabled={blocked}
              value={textColor(draft) ?? "#242d27"}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <input
            id={`${id}-value`}
            type={panel.key === "size" ? "number" : "text"}
            min={6}
            max={72}
            step={0.5}
            aria-invalid={value === undefined}
            aria-describedby={`${id}-help`}
            disabled={blocked}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <p
          id={`${id}-help`}
          className={value === undefined ? "form-error" : "document-format-help"}
        >
          {panel.key === "size"
            ? "6–72 磅，每次可调整 0.5 磅。"
            : "输入六位 HEX 颜色，例如 #c00000。"}
        </p>
      </div>
      <div className="document-format-actions">
        <button type="button" className="button button--ghost button--small" onClick={cancel}>
          取消
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={blocked || value === undefined}
          onClick={() => value !== undefined && apply(value)}
        >
          应用
        </button>
      </div>
    </div>,
    panel.container,
  );
}
