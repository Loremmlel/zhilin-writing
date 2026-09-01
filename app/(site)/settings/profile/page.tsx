import { ProfileForm } from "@/components/profile/profile-form";
import { requireMember } from "@/lib/auth/access";
import { updateProfileAction } from "./actions";

export default async function ProfileSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ member }, { error }] = await Promise.all([requireMember("/settings/profile"), searchParams]);
  return (
    <div className="page-column settings-page">
      <header className="page-header"><span className="eyebrow">个人资料</span><h1>编辑社区中的自己</h1><p>过去的帖子会自动显示你当前的名称与头像。</p></header>
      <ProfileForm action={updateProfileAction} member={{ displayName: member.displayName, bio: member.bio, avatarAssetId: member.avatarAssetId }} initialError={error} />
    </div>
  );
}
