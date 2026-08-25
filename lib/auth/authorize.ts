import { normalizeEmail } from "../domain/rules.ts";

type AccessDependencies<T> = {
  findAllowedUser(email: string): Promise<T | null>;
  ensureConfiguredAdministrator(email: string): Promise<T | null>;
};

export async function resolveAllowedIdentity<T>(
  identityEmail: string,
  configuredAdminEmail: string | null | undefined,
  dependencies: AccessDependencies<T>,
) {
  const emailKey = normalizeEmail(identityEmail);
  const administratorEmail = configuredAdminEmail
    ? normalizeEmail(configuredAdminEmail)
    : null;

  const allowed =
    administratorEmail && emailKey === administratorEmail
      ? await dependencies.ensureConfiguredAdministrator(administratorEmail)
      : await dependencies.findAllowedUser(emailKey);

  return { emailKey, allowed };
}
