import { redirect } from "next/navigation";

import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { addAllowedUser, allowlistCount, findAllowedUser, findUserByEmail } from "@/db/queries";
import { normalizeEmail } from "@/lib/domain/rules";

export async function requireSiteAccess(returnTo: string) {
  const identity = await requireChatGPTUser(returnTo);
  const emailKey = normalizeEmail(identity.email);
  let allowed = await findAllowedUser(emailKey);

  if (!allowed && (await allowlistCount()) === 0) {
    allowed = await addAllowedUser(emailKey, true);
  }

  if (!allowed) redirect("/access-denied");

  const member = await findUserByEmail(emailKey);
  return { identity, emailKey, allowed, member };
}

export async function requireMember(returnTo: string) {
  const access = await requireSiteAccess(returnTo);
  if (!access.member) redirect(`/onboarding?return_to=${encodeURIComponent(returnTo)}`);
  return { ...access, member: access.member };
}

export async function requireAdministrator(returnTo: string) {
  const access = await requireMember(returnTo);
  if (!access.allowed.isAdmin) redirect("/");
  return access;
}
