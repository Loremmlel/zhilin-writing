import { ProfileForm } from "@/components/profile/profile-form";
import { requireMember } from "@/lib/auth/access";
import { canAccessWriting } from "@/lib/auth/permissions";
import { updateProfileAction } from "./actions";

export const metadata = { title: "个人资料" };

export default async function ProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ member, allowed }, { error }] = await Promise.all([
    requireMember("/settings/profile"),
    searchParams,
  ]);
  return (
    <div className="page-column settings-page">
      <header className="page-header">
        <div>
          <h1>个人资料</h1>
          {canAccessWriting(allowed) && <p>过去的帖子会显示你当前的名称与头像。</p>}
        </div>
      </header>
      <ProfileForm
        action={updateProfileAction}
        member={{
          displayName: member.displayName,
          bio: member.bio,
          avatarAssetId: member.avatarAssetId,
        }}
        initialError={error}
      />
    </div>
  );
}
