import { normalizeEmail } from "../domain/rules.ts";

type AccessDependencies<T> = {
  findAllowedUser(email: string): Promise<T | null>;
  ensureConfiguredAdministrator(email: string): Promise<T | null>;
};

type ApiAccessDependencies<TAllowed, TMember> = AccessDependencies<TAllowed> & {
  findMemberByEmail(email: string): Promise<TMember | null>;
};

export type ApiMemberAccess<TAllowed, TMember> =
  | { ok: true; member: TMember; allowed: TAllowed }
  | {
      ok: false;
      code: "AUTH_EXPIRED" | "ACCESS_REVOKED" | "ONBOARDING_REQUIRED";
      status: 401 | 403;
    };

export async function resolveAllowedIdentity<T>(
  identityEmail: string,
  configuredAdminEmail: string | null | undefined,
  dependencies: AccessDependencies<T>,
) {
  const emailKey = normalizeEmail(identityEmail);
  const administratorEmail = configuredAdminEmail ? normalizeEmail(configuredAdminEmail) : null;

  const allowed =
    administratorEmail && emailKey === administratorEmail
      ? await dependencies.ensureConfiguredAdministrator(administratorEmail)
      : await dependencies.findAllowedUser(emailKey);

  return { emailKey, allowed };
}

export async function resolveApiMemberAccess<TAllowed, TMember>(
  identity: { email: string } | null,
  configuredAdminEmail: string | null | undefined,
  dependencies: ApiAccessDependencies<TAllowed, TMember>,
): Promise<ApiMemberAccess<TAllowed, TMember>> {
  if (!identity) return { ok: false, code: "AUTH_EXPIRED", status: 401 };
  const { emailKey, allowed } = await resolveAllowedIdentity(
    identity.email,
    configuredAdminEmail,
    dependencies,
  );
  if (!allowed) return { ok: false, code: "ACCESS_REVOKED", status: 403 };
  const member = await dependencies.findMemberByEmail(emailKey);
  return member
    ? { ok: true, member, allowed }
    : { ok: false, code: "ONBOARDING_REQUIRED", status: 403 };
}
