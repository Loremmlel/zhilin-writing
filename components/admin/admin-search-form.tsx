"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import type { AdminContentType, AdminContentStatus, AdminSort } from "@/lib/admin/query";

export function AdminSearchForm({
  type,
  status,
  query,
  sort,
  clearHref,
}: {
  type: AdminContentType;
  status: AdminContentStatus;
  query: string;
  sort: AdminSort;
  clearHref: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  return (
    <form className="admin-toolbar" action="/admin" method="get" noValidate>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="status" value={status} />
      <label className="admin-search-field">
        <span className="sr-only">搜索当前内容</span>
        <input
          ref={inputRef}
          className="text-input"
          type="search"
          name="q"
          defaultValue={query}
          maxLength={100}
          placeholder="搜索内容、帖子或作者"
        />
        {query && (
          <button
            className="admin-search-clear"
            type="button"
            aria-label="清除搜索"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              inputRef.current?.focus();
              router.push(clearHref);
            }}
          >
            ×
          </button>
        )}
      </label>
      <label className="admin-sort-field">
        <span className="sr-only">排序方式</span>
        <select name="sort" defaultValue={sort}>
          <option value="newest">最新在前</option>
          <option value="oldest">最早在前</option>
        </select>
      </label>
      <button className="button button--primary button--small" type="submit">
        搜索
      </button>
    </form>
  );
}
