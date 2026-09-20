import { redirect } from "next/navigation";
import { cacheForRequest } from "vinext/cache";
import { env } from "cloudflare:workers";

import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { findAllowedMember } from "@/db/queries";
import { normalizeEmail } from "@/lib/domain/rules";
import { canAccessWriting } from "./permissions";

async function readAccess() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  const emailKey = normalizeEmail(identity.email);
  const owner =
    typeof env.BOOTSTRAP_ADMIN_EMAIL === "string"
      ? normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL)
      : null;
  const result = await findAllowedMember(emailKey, owner);
  return { identity, emailKey, allowed: result?.allowed ?? null, member: result?.member ?? null };
}
// Actions resolve fresh access; never seed page rerenders with pre-mutation profiles.
const getRequestAccess = cacheForRequest(readAccess);

export async function getApiMemberAccess() {
  const access = await readAccess();
  if (!access) return { ok: false as const, code: "AUTH_EXPIRED" as const, status: 401 as const };
  if (!access.allowed)
    return { ok: false as const, code: "ACCESS_REVOKED" as const, status: 403 as const };
  if (!access.member)
    return { ok: false as const, code: "ONBOARDING_REQUIRED" as const, status: 403 as const };
  return { ok: true as const, member: access.member, allowed: access.allowed };
}

export async function getActionAdministratorAccess() {
  const access = await getApiMemberAccess();
  if (!access.ok) return access;
  if (!access.allowed.isAdmin)
    return { ok: false as const, code: "ADMIN_REQUIRED" as const, status: 403 as const };
  return access;
}

export async function getApiWritingAccess() {
  const access = await getApiMemberAccess();
  if (!access.ok) return access;
  if (!canAccessWriting(access.allowed))
    return { ok: false as const, code: "WRITING_REQUIRED" as const, status: 403 as const };
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

export async function requireWritingMember(returnTo: string) {
  const access = await requireMember(returnTo);
  if (!canAccessWriting(access.allowed)) redirect("/games/haojie");
  return access;
}
