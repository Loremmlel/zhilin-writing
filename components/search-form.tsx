"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function SearchForm({
  query = "",
  id,
  compact = false,
}: {
  query?: string;
  id: string;
  compact?: boolean;
}) {
  const [value, setValue] = useState(query);
  const [committedQuery, setCommittedQuery] = useState(query);
  if (committedQuery !== query) {
    setCommittedQuery(query);
    setValue(query);
  }
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const router = useRouter();
  return (
    <form
      action="/search"
      role="search"
      className={compact ? "header-search" : "search-page-form"}
      noValidate
      onSubmit={(event) => {
        if (composing.current) event.preventDefault();
      }}
    >
      <label className="sr-only" htmlFor={id}>
        搜索帖子标题或正文
      </label>
      <input
        ref={input}
        id={id}
        className={compact ? undefined : "text-input"}
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="搜索帖子标题或正文"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229))
            event.preventDefault();
        }}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="清除搜索"
          onClick={() => {
            setValue("");
            input.current?.focus();
            router.push("/search");
          }}
        >
          ×
        </button>
      )}
      <button
        className={compact ? "search-submit" : "button button--primary"}
        type="submit"
        aria-label="提交搜索"
      >
        搜索
      </button>
    </form>
  );
}

export function HeaderSearch() {
  const params = useSearchParams();
  const pathname = usePathname();
  const query = pathname === "/search" ? (params.get("q") ?? "") : "";
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`header-search-area${open ? " is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={toggleRef}
        className="mobile-search-toggle button button--text"
        aria-label={open ? "收起搜索" : "展开搜索"}
        aria-expanded={open}
        aria-controls="header-search-form"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10" cy="10" r="6.5" />
          <path d="m15 15 5 5" />
        </svg>
      </button>
      <div id="header-search-form">
        <SearchForm query={query} id="header-post-search" compact />
      </div>
    </div>
  );
}

export function FocusSearchButton({ id }: { id: string }) {
  return (
    <button
      className="button button--ghost"
      type="button"
      onClick={() => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        input?.focus();
        input?.select();
      }}
    >
      修改搜索
    </button>
  );
}
