import assert from "node:assert/strict";
import test from "node:test";

test("an unknown first visitor cannot claim the administrator role", async () => {
  const authModule = await import("../lib/auth/authorize.ts").catch(() => null);
  assert.ok(authModule, "the explicit administrator resolver must exist");

  let administratorClaims = 0;
  const result = await authModule.resolveAllowedIdentity(
    "preview-bot@example.com",
    "owner@example.com",
    {
      findAllowedUser: async () => null,
      ensureConfiguredAdministrator: async () => {
        administratorClaims += 1;
        return { email: "owner@example.com", isAdmin: true };
      },
    },
  );

  assert.equal(result.emailKey, "preview-bot@example.com");
  assert.equal(result.allowed, null);
  assert.equal(administratorClaims, 0);
});

test("the configured owner is initialized as administrator", async () => {
  const authModule = await import("../lib/auth/authorize.ts").catch(() => null);
  assert.ok(authModule, "the explicit administrator resolver must exist");

  const result = await authModule.resolveAllowedIdentity(
    " Owner@Example.COM ",
    "owner@example.com",
    {
      findAllowedUser: async () => null,
      ensureConfiguredAdministrator: async (email: string) => ({ email, isAdmin: true }),
    },
  );

  assert.deepEqual(result, {
    emailKey: "owner@example.com",
    allowed: { email: "owner@example.com", isAdmin: true },
  });
});

test("API member resolution returns typed outcomes without page redirects", async () => {
  const authModule = await import("../lib/auth/authorize.ts");
  const baseDependencies = {
    findAllowedUser: async () => ({ email: "member@example.com", isAdmin: false }),
    ensureConfiguredAdministrator: async () => null,
    findMemberByEmail: async () => ({ id: "member-id" }),
  };

  assert.deepEqual(
    await authModule.resolveApiMemberAccess(null, null, baseDependencies),
    { ok: false, code: "AUTH_REQUIRED", status: 401 },
  );
  assert.deepEqual(
    await authModule.resolveApiMemberAccess(
      { email: "revoked@example.com" },
      null,
      { ...baseDependencies, findAllowedUser: async () => null },
    ),
    { ok: false, code: "MEMBER_REQUIRED", status: 403 },
  );
  assert.deepEqual(
    await authModule.resolveApiMemberAccess(
      { email: "member@example.com" },
      null,
      { ...baseDependencies, findMemberByEmail: async () => null },
    ),
    { ok: false, code: "ONBOARDING_REQUIRED", status: 403 },
  );
  assert.deepEqual(
    await authModule.resolveApiMemberAccess({ email: "member@example.com" }, null, baseDependencies),
    { ok: true, member: { id: "member-id" } },
  );
});
