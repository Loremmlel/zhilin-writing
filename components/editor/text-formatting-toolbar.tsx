"use client";

import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyTextFormatting,
  captureFormattingSelection,
  formattingStatus,
  releaseFormattingSelection,
} from "@/lib/editor/text-formatting-commands";
import { ModalDialog } from "../modal-dialog";
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
export function TextFormattingToolbar({ view, disabled }: { view: EditorView; disabled: boolean }) {
  const [custom, setCustom] = useState<"size" | "color" | null>(null);
  const [draft, setDraft] = useState("");
  const restoreEditor = useRef(false);
  useEffect(() => {
    if (custom === null && restoreEditor.current) {
      restoreEditor.current = false;
      view.focus();
    }
  }, [custom, view]);
  const status = formattingStatus(view.state);
  const blocked = disabled || !status.supported;
  useEffect(() => {
    if (!custom || status.supported) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setCustom(null);
      releaseFormattingSelection(view);
    });
    return () => {
      active = false;
    };
  }, [custom, status.supported, view]);
  const close = () => {
    setCustom(null);
    if (!custom) view.focus();
    releaseFormattingSelection(view);
  };
  const apply = (key: "size" | "color" | "center", value: number | string | boolean | null) => {
    if (!blocked) applyTextFormatting(view, key, value);
    setCustom(null);
    if (custom) restoreEditor.current = true;
  };
  const select = (key: "size" | "color", element: HTMLSelectElement) => {
    if (element.value === "custom") {
      setCustom(key);
      setDraft(
        key === "size"
          ? status.size === "default" || status.size === "mixed"
            ? "12"
            : status.size
          : (textColor(status.color) ?? "#242d27"),
      );
    } else
      apply(
        key,
        element.value === "default" ? null : key === "size" ? Number(element.value) : element.value,
      );
  };
  return (
    <div
      className="text-formatting-toolbar"
      role="group"
      aria-label="正文格式"
      onPointerDownCapture={() => captureFormattingSelection(view)}
      onFocusCapture={() => captureFormattingSelection(view)}
      onBlurCapture={(event) => {
        if (!custom && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setCustom(null);
          releaseFormattingSelection(view);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key === "Enter") {
          event.stopPropagation();
          if (custom && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            if (event.nativeEvent.isComposing) return;
            const value = custom === "size" ? fontSize(draft) : textColor(draft);
            if (value !== undefined) apply(custom, value);
          }
        }
      }}
    >
      <label>
        字号{" "}
        <select
          aria-label="字号"
          disabled={blocked}
          value={status.size}
          onChange={(event) => select("size", event.currentTarget)}
        >
          <option value="default">默认</option>
          <option value="mixed" disabled>
            混合
          </option>
          {!["default", "mixed"].includes(status.size) && !sizes.includes(Number(status.size)) && (
            <option value={status.size}>{status.size} 磅</option>
          )}
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size} 磅
            </option>
          ))}
          <option value="custom">自定义…</option>
        </select>
      </label>
      <label>
        颜色{" "}
        <select
          aria-label="文字颜色"
          disabled={blocked}
          value={status.color}
          onChange={(event) => select("color", event.currentTarget)}
        >
          <option value="default">默认</option>
          <option value="mixed" disabled>
            混合
          </option>
          {!["default", "mixed"].includes(status.color) &&
            !colors.some(([color]) => color === status.color) && (
              <option value={status.color}>{status.color}</option>
            )}
          {colors.map(([color, label]) => (
            <option key={color} value={color}>
              {label}
            </option>
          ))}
          <option value="custom">自定义…</option>
        </select>
      </label>
      <button
        className="button button--ghost button--small"
        type="button"
        disabled={blocked}
        aria-pressed={status.center}
        onClick={() => apply("center", status.center !== true)}
      >
        {status.center === "mixed" ? "居中（混合）" : "居中"}
      </button>
      {!status.supported && <span className="text-formatting-hint">请选择正文段落或表格文字</span>}
      {custom && (
        <ModalDialog open title={custom === "size" ? "自定义字号" : "自定义颜色"} onClose={close}>
          <div
            className="text-formatting-custom"
            role="group"
            aria-label={custom === "size" ? "自定义字号" : "自定义颜色"}
          >
            <label>
              {custom === "size" ? "字号（6–72 磅，步长 0.5）" : "颜色（HEX）"}
              <input
                disabled={blocked}
                aria-label={custom === "size" ? "自定义字号" : "颜色 HEX"}
                type={custom === "size" ? "number" : "text"}
                min={6}
                max={72}
                step={0.5}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            {custom === "color" && (
              <input
                disabled={blocked}
                type="color"
                aria-label="选择颜色"
                value={textColor(draft) ?? "#242d27"}
                onChange={(event) => setDraft(event.target.value)}
              />
            )}
            {(custom === "size" ? fontSize(draft) === undefined : !textColor(draft)) && (
              <p className="form-error" role="status">
                {custom === "size"
                  ? "请输入 6–72 磅的字号，步长为 0.5。"
                  : "请输入六位 HEX 颜色，例如 #c00000。"}
              </p>
            )}
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={
                blocked || (custom === "size" ? fontSize(draft) === undefined : !textColor(draft))
              }
              onClick={() =>
                apply(custom, custom === "size" ? fontSize(draft)! : textColor(draft)!)
              }
            >
              应用
            </button>
            <button type="button" className="button button--ghost button--small" onClick={close}>
              取消
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
