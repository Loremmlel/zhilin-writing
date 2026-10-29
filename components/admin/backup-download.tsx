"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/modal-dialog";

export function BackupDownload() {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  return (
    <div>
      <button className="button button--primary" type="button" onClick={() => setOpen(true)}>
        导出数据备份 ZIP
      </button>
      {requested && (
        <p role="status">
          已发起备份请求，请查看浏览器下载或新窗口的错误提示。下载完成不等于验证通过；请解压后运行
          restore.py，校验成功再保留为有效备份。
        </p>
      )}
      <ModalDialog
        open={open}
        title="下载全部应用数据？"
        description="导出期间请暂停编辑、上传及删除，避免数据前后不一致。备份包含成员邮箱、隐藏及已软删除的私密内容和附件。密码和会话记录不会导出，恢复后需重新设定本地密码。请只保存到可信设备，不要上传到 GitHub 或公开网盘。"
        onClose={() => setOpen(false)}
        alert
      >
        <form
          action="/api/admin/backup"
          method="POST"
          target="_blank"
          noValidate
          onSubmit={() => {
            setRequested(true);
            window.setTimeout(() => setOpen(false), 0);
          }}
        >
          <div className="dialog-actions">
            <button className="button button--ghost" type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="button button--primary" type="submit">
              确认导出备份
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
