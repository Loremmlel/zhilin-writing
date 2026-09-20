"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import {
  HAOJIE_EMOJIS,
  reactionFlight,
  type HaojieEmoji,
  type RoomReaction,
} from "@/lib/haojie/reactions";

function FallingReaction({ item, own }: { item: RoomReaction; own: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const flight = reactionFlight(item.id, window.innerWidth, window.innerHeight);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.style.visibility = "visible";
    const animation = node.animate(
      reduced
        ? [
            { transform: `translate(${flight.start}px, 24px)`, opacity: 1 },
            { transform: `translate(${flight.start}px, 24px)`, opacity: 0 },
          ]
        : flight.keyframes,
      { duration: reduced ? 1200 : flight.duration, easing: "linear", fill: "forwards" },
    );
    animation.onfinish = () => {
      node.style.visibility = "hidden";
      animation.cancel();
    };
    return () => animation.cancel();
  }, [item]);
  return (
    <span
      ref={ref}
      className={`haojie-reaction${own ? " haojie-reaction--own" : ""}`}
      aria-hidden="true"
    >
      {item.emoji}
    </span>
  );
}

export function HaojieReactions({
  items,
  viewer,
}: {
  items: RoomReaction[];
  viewer: number | null;
}) {
  const last = items.at(-1);
  if (!last) return null;
  const label = HAOJIE_EMOJIS.find(([emoji]) => emoji === last.emoji)?.[1] ?? "表情";
  return (
    <>
      <span className="sr-only" role="status">
        {last.player === viewer ? "你" : "对方"}发送了{label}
      </span>
      {createPortal(
        <div className="haojie-reaction-layer" aria-hidden="true">
          {items.map((item) => (
            <FallingReaction key={item.id} item={item} own={item.player === viewer} />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function HaojieEmojiPicker({
  disabled,
  pending,
  onSend,
}: {
  disabled: boolean;
  pending: number;
  onSend: (emoji: HaojieEmoji) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  function placePanel() {
    const node = panel.current;
    const anchor = trigger.current;
    if (!node || !anchor || !node.matches(":popover-open")) return;
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    node.style.left = `${Math.max(left + 12, Math.min(rect.right - node.offsetWidth, left + width - node.offsetWidth - 12))}px`;
    const below = rect.bottom + 8;
    node.style.top = `${Math.max(top + 12, Math.min(below + node.offsetHeight <= top + height - 12 ? below : rect.top - node.offsetHeight - 8, top + height - node.offsetHeight - 12))}px`;
  }
  useEffect(() => {
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    window.visualViewport?.addEventListener("resize", placePanel);
    window.visualViewport?.addEventListener("scroll", placePanel);
    return () => {
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
      window.visualViewport?.removeEventListener("resize", placePanel);
      window.visualViewport?.removeEventListener("scroll", placePanel);
    };
  }, []);
  useEffect(() => {
    if (disabled) panel.current?.hidePopover();
  }, [disabled]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button button--ghost"
        popoverTarget={id}
        disabled={disabled}
      >
        <span aria-hidden="true">☺</span> 表情
      </button>
      <div
        ref={panel}
        id={id}
        className="haojie-emoji-picker"
        popover="auto"
        role="dialog"
        aria-label="发送表情"
        onToggle={(event) => {
          if (event.newState === "open") {
            placePanel();
            panel.current
              ?.querySelector<HTMLButtonElement>(".haojie-emoji-option")
              ?.focus({ preventScroll: true });
          }
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger.current
          )
            panel.current?.hidePopover();
        }}
      >
        <div className="haojie-emoji-heading">
          <strong>表情</strong>
          <button
            type="button"
            className="button button--text"
            aria-label="关闭表情选择"
            onClick={() => {
              panel.current?.hidePopover();
              trigger.current?.focus();
            }}
          >
            ×
          </button>
        </div>
        <div className="haojie-emoji-grid">
          {HAOJIE_EMOJIS.map(([emoji, label]) => (
            <button
              key={emoji}
              type="button"
              className="haojie-emoji-option"
              title={label}
              aria-label={`发送${label}`}
              disabled={disabled}
              onClick={() => onSend(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
        <p className="haojie-emoji-pending" role="status">
          {pending ? `${pending} 个表情待发送` : ""}
        </p>
      </div>
    </>
  );
}
