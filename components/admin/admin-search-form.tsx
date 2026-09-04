"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import type { AdminContentType, AdminContentStatus, AdminSort } from "@/lib/admin/query";

export function AdminSearchForm({
  type,
  status,
  query,
  sort,
  from,
  to,
  searchClearHref,
  clearHref,
}: {
  type: AdminContentType;
  status: AdminContentStatus;
  query: string;
  sort: AdminSort;
  from: string;
  to: string;
  searchClearHref: string;
  clearHref: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  return (
    <form className="admin-toolbar" action="/admin" method="get" noValidate>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="status" value={status} />
      <label className="admin-filter-field admin-search-field">
        <span>搜索</span>
        <span className="admin-search-control">
          <input
            ref={inputRef}
            className="text-input"
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder="内容、帖子或作者"
          />
          {query && (
            <button
              className="admin-search-clear"
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                inputRef.current?.focus();
                router.push(searchClearHref);
              }}
            >
              ×
            </button>
          )}
        </span>
      </label>
      <label className="admin-filter-field admin-date-field">
        <span>开始日期</span>
        <input
          className="text-input"
          type="date"
          name="from"
          defaultValue={from}
          title="日期按北京时间计算，起止日均包含在内"
        />
      </label>
      <label className="admin-filter-field admin-date-field">
        <span>结束日期</span>
        <input
          className="text-input"
          type="date"
          name="to"
          defaultValue={to}
          title="日期按北京时间计算，起止日均包含在内"
        />
      </label>
      <label className="admin-filter-field admin-sort-field">
        <span>排序</span>
        <select name="sort" defaultValue={sort}>
          <option value="newest">最新在前</option>
          <option value="oldest">最早在前</option>
        </select>
      </label>
      <div className="admin-toolbar-actions">
        {(query || from || to) && (
          <button
            className="button button--ghost button--small"
            type="button"
            onClick={() => router.push(clearHref)}
          >
            清除筛选
          </button>
        )}
        <button className="button button--primary button--small" type="submit">
          应用筛选
        </button>
      </div>
    </form>
  );
}
