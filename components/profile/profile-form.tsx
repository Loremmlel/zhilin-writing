"use client";

import { startTransition, useActionState } from "react";

import type { ProfileActionState } from "@/app/(site)/settings/profile/actions";
import { Avatar } from "@/components/avatar";

type ProfileFormProps = {
  action: (state: ProfileActionState, formData: FormData) => Promise<ProfileActionState>;
  member: {
    displayName: string;
    bio: string;
    avatarAssetId: string | null;
  };
  initialError?: string;
};

export function ProfileForm({ action, member, initialError }: ProfileFormProps) {
  const [state, formAction, pending] = useActionState(action, initialError ? { error: initialError } : {});

  return <form className="settings-form" noValidate aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }}>
    <div className="avatar-setting"><Avatar name={member.displayName} assetId={member.avatarAssetId} size="large" /><label><span className="field-label">更换头像</span><input type="file" name="avatar" accept="image/*" disabled={pending} /></label></div>
    <label><span className="field-label">显示名称</span><input className="text-input" name="displayName" defaultValue={member.displayName} maxLength={30} required disabled={pending} /></label>
    <label><span className="field-label">个人简介</span><textarea className="text-area resize-none" name="bio" defaultValue={member.bio} maxLength={300} rows={5} disabled={pending} /></label>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <div className="form-actions">
      <button className={`button button--primary${pending ? " button--pending" : ""}`} type="submit" disabled={pending} aria-busy={pending}>{pending ? "保存中…" : "保存资料"}</button>
      <span className="sr-only" role="status" aria-live="polite">{pending ? "保存中…" : ""}</span>
    </div>
  </form>;
}
