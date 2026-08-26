"use client";

import { useState } from "react";

import { ModalDialog } from "@/components/modal-dialog";

export function RestoreRevisionForm({
  revisionNumber,
  action,
  restoresDeletedPost = false,
}: {
  revisionNumber: number;
  action: (formData: FormData) => Promise<void>;
  restoresDeletedPost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  return (
    <>
      <button type="button" className="button button--ghost" onClick={() => setOpen(true)}>恢复此版本</button>
      <ModalDialog
        open={open}
        title={`恢复 v${revisionNumber}？`}
        description={restoresDeletedPost
          ? "恢复会把这份历史内容复制成新的当前版本，并清除作者删除状态；若仍被管理员隐藏，普通成员仍不可见。帖子不会被顶到最近活跃。"
          : "恢复会把这份历史内容复制成一个新的当前版本；现有版本不会被删除，帖子也不会被顶到最近活跃。"}
        onClose={() => setOpen(false)}
        alert
      >
        <form action={action} className="dialog-actions" noValidate>
          <input type="hidden" name="operationId" value={operationId} />
          <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>取消</button>
          <button type="submit" className="button button--danger">确认恢复</button>
        </form>
      </ModalDialog>
    </>
  );
}
