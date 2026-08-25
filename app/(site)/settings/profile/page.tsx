import { Avatar } from "@/components/avatar";
import { requireMember } from "@/lib/auth/access";
import { updateProfileAction } from "./actions";

export default async function ProfileSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ member }, { error }] = await Promise.all([requireMember("/settings/profile"), searchParams]);
  return (
    <div className="page-column settings-page">
      <header className="page-header"><span className="eyebrow">个人资料</span><h1>编辑社区中的自己</h1><p>过去的帖子会自动显示你当前的名称与头像。</p></header>
      <form action={updateProfileAction} className="settings-form">
        <div className="avatar-setting"><Avatar name={member.displayName} assetId={member.avatarAssetId} size="large" /><label><span className="field-label">更换头像</span><input type="file" name="avatar" accept="image/*" /></label></div>
        <label><span className="field-label">显示名称</span><input className="text-input" name="displayName" defaultValue={member.displayName} maxLength={30} required /></label>
        <label><span className="field-label">个人简介</span><textarea className="text-area" name="bio" defaultValue={member.bio} maxLength={300} rows={5} /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button className="button button--primary">保存资料</button></div>
      </form>
    </div>
  );
}
