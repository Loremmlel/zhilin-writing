import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";

import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { ensureConfiguredAdministrator, findAllowedUser, findUserByEmail } from "@/db/queries";
import { resolveAllowedIdentity } from "@/lib/auth/authorize";

export async function requireSiteAccess(returnTo: string) {
  const identity = await requireChatGPTUser(returnTo);
  const { emailKey, allowed } = await resolveAllowedIdentity(
    identity.email,
    typeof env.BOOTSTRAP_ADMIN_EMAIL === "string"
      ? env.BOOTSTRAP_ADMIN_EMAIL
      : null,
    { findAllowedUser, ensureConfiguredAdministrator },
  );

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
