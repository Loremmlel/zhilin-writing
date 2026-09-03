import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

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
    { ok: false, code: "AUTH_EXPIRED", status: 401 },
  );
  assert.deepEqual(
    await authModule.resolveApiMemberAccess(
      { email: "revoked@example.com" },
      null,
      { ...baseDependencies, findAllowedUser: async () => null },
    ),
    { ok: false, code: "ACCESS_REVOKED", status: 403 },
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
    { ok: true, member: { id: "member-id" }, allowed: { email: "member@example.com", isAdmin: false } },
  );
});

test("action access failures use the exact expiry and revocation recovery copy", async () => {
  const { actionAccessFailure, isBlockingAccessError } = await import("../lib/actions/result.ts");
  assert.deepEqual(actionAccessFailure("AUTH_EXPIRED"), {
    error: "登录状态已失效，请重新登录后继续。",
    code: "AUTH_EXPIRED",
  });
  assert.deepEqual(actionAccessFailure("ACCESS_REVOKED"), {
    error: "你的站点访问权限已被移除。",
    code: "ACCESS_REVOKED",
  });
  assert.equal(isBlockingAccessError("AUTH_EXPIRED"), false);
  assert.equal(isBlockingAccessError("ACCESS_REVOKED"), true);
});

test("mutations and asset APIs use typed access instead of navigation redirects", async () => {
  const paths = [
    "app/(site)/admin/actions.ts",
    "app/(site)/admin/revisions/[postId]/actions.ts",
    "app/(site)/notifications/actions.ts",
    "app/(site)/posts/[id]/actions.ts",
    "app/(site)/posts/new/actions.ts",
    "app/(site)/settings/profile/actions.ts",
    "app/api/assets/route.ts",
    "app/api/assets/[id]/route.ts",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));

  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /requireMember|requireAdministrator/, paths[index]);
    assert.match(source, /getApiMemberAccess|getActionAdministratorAccess/, paths[index]);
  }
});
