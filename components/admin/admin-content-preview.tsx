"use client";

import { useState } from "react";

import { ModalDialog } from "@/components/modal-dialog";

export function AdminContentPreview({
  title,
  markdown,
  quote,
}: {
  title: string;
  markdown: string;
  quote?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="text-button" type="button" onClick={() => setOpen(true)}>
        原文
      </button>
      <ModalDialog
        open={open}
        title={title}
        description="只读查看完整内容；关闭后仍停留在当前筛选和选择状态。"
        onClose={() => setOpen(false)}
      >
        <div className="admin-raw-preview">
          {quote && (
            <blockquote>
              <span>引用</span>
              {quote}
            </blockquote>
          )}
          <pre>{markdown}</pre>
          <div className="dialog-actions">
            <button className="button button--primary" type="button" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>
        </div>
      </ModalDialog>
    </>
  );
}
