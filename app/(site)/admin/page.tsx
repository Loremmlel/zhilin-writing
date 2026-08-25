import { listAllowedUsers, listUsers } from "@/db/queries";
import { requireAdministrator } from "@/lib/auth/access";
import { formatDateTime } from "@/lib/format";
import { addAllowlistAction, removeAllowlistAction } from "./actions";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [, allowed, users, { error }] = await Promise.all([requireAdministrator("/admin"), listAllowedUsers(), listUsers(), searchParams]);
  return (
    <div className="page-column admin-page">
      <header className="page-header"><span className="eyebrow">管理员</span><h1>管理受邀成员</h1><p>这里只保留 V1 必需的邮箱白名单与已注册成员列表。</p></header>
      <section className="admin-section"><div className="section-heading"><h2>邀请邮箱</h2><span>{allowed.length} 个</span></div>
        <form action={addAllowlistAction} className="inline-form"><input className="text-input" type="email" name="email" placeholder="friend@example.com" required /><button className="button button--primary">加入白名单</button></form>
        {error && <p className="form-error">{error}</p>}
        <div className="admin-list">{allowed.map((entry) => <div className="admin-row" key={entry.id}><div><strong>{entry.email}</strong><span>{entry.isAdmin ? "唯一管理员" : `添加于 ${formatDateTime(entry.addedAt)}`}</span></div>{!entry.isAdmin && <form action={removeAllowlistAction}><input type="hidden" name="id" value={entry.id} /><button className="text-button text-button--danger">移除</button></form>}</div>)}</div>
      </section>
      <section className="admin-section"><div className="section-heading"><h2>已注册成员</h2><span>{users.length} 位</span></div><div className="admin-list">{users.map((user) => <div className="admin-row" key={user.id}><div><strong>{user.displayName}</strong><span>{formatDateTime(user.joinedAt)} 加入</span></div></div>)}</div></section>
    </div>
  );
}
