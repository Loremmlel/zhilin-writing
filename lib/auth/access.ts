import { redirect } from "next/navigation";
import { cacheForRequest } from "vinext/cache";
import { env } from "cloudflare:workers";

import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { ensureConfiguredAdministrator, findAllowedUser, findUserByEmail } from "@/db/queries";
import { resolveAllowedIdentity, resolveApiMemberAccess } from "@/lib/auth/authorize";

// Share page/layout reads only. Actions resolve access afresh before mutations.
// No permissions or profile data are reused across requests.
const getRequestAccess = cacheForRequest(async () => {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  const { emailKey, allowed } = await resolveAllowedIdentity(
    identity.email,
    typeof env.BOOTSTRAP_ADMIN_EMAIL === "string" ? env.BOOTSTRAP_ADMIN_EMAIL : null,
    { findAllowedUser, ensureConfiguredAdministrator },
  );
  const member = allowed ? await findUserByEmail(emailKey) : null;
  return { identity, emailKey, allowed, member };
});

export async function getApiMemberAccess() {
  return resolveApiMemberAccess(
    await getChatGPTUser(),
    typeof env.BOOTSTRAP_ADMIN_EMAIL === "string" ? env.BOOTSTRAP_ADMIN_EMAIL : null,
    { findAllowedUser, ensureConfiguredAdministrator, findMemberByEmail: findUserByEmail },
  );
}

export async function getActionAdministratorAccess() {
  const access = await getApiMemberAccess();
  if (!access.ok) return access;
  if (!access.allowed.isAdmin)
    return { ok: false as const, code: "ADMIN_REQUIRED" as const, status: 403 as const };
  return access;
}

export async function requireSiteAccess(returnTo: string) {
  const access = await getRequestAccess();
  if (!access) redirect(chatGPTSignInPath(returnTo));
  if (!access.allowed) redirect("/access-denied");
  return { ...access, allowed: access.allowed };
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
