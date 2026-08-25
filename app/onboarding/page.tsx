import { redirect } from "next/navigation";

import { requireSiteAccess } from "@/lib/auth/access";
import { createProfileAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const access = await requireSiteAccess("/onboarding");
  if (access.member) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="centered-page onboarding-page">
      <form action={createProfileAction} className="quiet-card onboarding-card" noValidate>
        <div className="onboarding-brand">知临中学</div>
        <span className="eyebrow">第一次来到这里</span>
        <h1>先留下一个称呼</h1>
        <p>这里的名字只用于社区内展示。你的登录邮箱只作为私密身份键，不会出现在帖子或个人主页中。</p>
        <label>
          <span className="field-label">显示名称</span>
          <input className="text-input" name="displayName" defaultValue={access.identity.fullName ?? ""} maxLength={30} required />
        </label>
        <label>
          <span className="field-label">个人简介（可选）</span>
          <textarea className="text-area resize-none" name="bio" maxLength={300} rows={4} placeholder="写一点你愿意让朋友知道的事情……" />
        </label>
        <p className="muted">头像可以进入社区后再设置。</p>
        {error && <p className="form-error">{error}</p>}
        <button className="button button--primary" type="submit">进入社区</button>
      </form>
    </main>
  );
}
