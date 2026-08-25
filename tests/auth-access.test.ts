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
