import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { BackupDownload } from "@/components/admin/backup-download";
import { requireAdministrator } from "@/lib/auth/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "数据备份" };

export default async function BackupPage() {
  await requireAdministrator("/admin/backup");
  return (
    <AdminShell active="backup">
      <div className="admin-page">
        <header className="admin-page-header">
          <div>
            <span className="eyebrow">管理员</span>
            <h1>数据备份</h1>
            <p>将数据库与附件一起下载，留存一份可恢复的私密备份。</p>
          </div>
        </header>
        <section className="admin-section admin-backup-copy" aria-labelledby="backup-scope">
          <div className="section-heading">
            <h2 id="backup-scope">下载与校验</h2>
          </div>
          <p>
            ZIP 包含数据库 SQL、附件、文件清单和恢复说明。解压后运行 <code>python3 restore.py</code>
            （Windows 可用 <code>py restore.py</code>），校验备份并生成真正的 SQLite 数据库{" "}
            <code>zhilin.db</code>。
          </p>
          <p>
            <strong>导出期间请暂停编辑、上传及删除，避免数据前后不一致。</strong>
            下载可能需要一些时间，请保持下载窗口打开。
          </p>
          <p>
            备份包含私密内容和成员邮箱，请妥善保管。密码和会话不会导出；恢复网站后需由管理员重设成员的本地密码。
          </p>
          <BackupDownload />
          <details className="admin-backup-details">
            <summary>备份范围与技术说明</summary>
            <p>
              包括成员与白名单、帖子、回复、批注、历史版本、标签、通知、管理与性能日志、对局数据，以及业务记录引用的现存附件、历史文件和对局档案。隐藏和软删除内容也会保留。
            </p>
            <p>
              不包含已物理删除的内容、无业务引用的临时或孤立文件、浏览器本地草稿、密码、会话、登录限流记录及部署密钥。认证表保留空结构；恢复后成员需重新登录，ChatGPT
              身份配置需另外保管。
            </p>
            <p>
              数据库分页读取，不是全库事务快照，也不是与文件存储的原子快照。导出后会再次核对数据；检测到变化、关联异常或必要文件缺失会中止下载，请暂停操作后重试。
            </p>
            <p>
              采用流式下载，不设人为小容量截断；仍受平台请求资源与设备空间限制。失败或未通过
              restore.py 校验的文件不能作为有效备份。此页面不会覆盖或恢复线上数据。
            </p>
          </details>
        </section>
      </div>
    </AdminShell>
  );
}
