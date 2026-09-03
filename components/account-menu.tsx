"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import type { SiteUser } from "@/db/schema";
import { isAccountMenuDismissKey, isOutsideAccountMenu } from "@/lib/ui/account-menu";
import { Avatar } from "./avatar";

export function AccountMenu({ member, isAdmin }: { member: SiteUser; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        isOutsideAccountMenu(rootRef.current, event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isAccountMenuDismissKey(event.key)) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-menu-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar name={member.displayName} assetId={member.avatarAssetId} size="small" />
        <span>{member.displayName}</span>
      </button>
      {open && (
        <div className="account-popover" aria-label="账户选项">
          <Link href={`/users/${member.id}`} onClick={() => setOpen(false)}>
            我的主页
          </Link>
          <Link href="/settings/profile" onClick={() => setOpen(false)}>
            编辑资料
          </Link>
          <Link href="/tags" onClick={() => setOpen(false)}>
            全部标签
          </Link>
          {isAdmin && (
            <Link href="/admin" onClick={() => setOpen(false)}>
              管理后台
            </Link>
          )}
          <a href={chatGPTSignOutPath("/")}>退出登录</a>
        </div>
      )}
    </div>
  );
}
