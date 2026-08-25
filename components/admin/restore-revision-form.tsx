"use client";

import { useState } from "react";

import { ModalDialog } from "@/components/modal-dialog";

export function RestoreRevisionForm({
  revisionNumber,
  action,
}: {
  revisionNumber: number;
  action: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button button--ghost" onClick={() => setOpen(true)}>恢复此版本</button>
      <ModalDialog
        open={open}
        title={`恢复 v${revisionNumber}？`}
        description="恢复会把这份历史内容复制成一个新的当前版本；现有版本不会被删除，帖子也不会被顶到最近活跃。"
        onClose={() => setOpen(false)}
        alert
      >
        <form action={action} className="dialog-actions" noValidate>
          <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>取消</button>
          <button type="submit" className="button button--danger">确认恢复</button>
        </form>
      </ModalDialog>
    </>
  );
}
