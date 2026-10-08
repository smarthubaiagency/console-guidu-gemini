import { describe, expect, it } from "vitest";

import { decideAccess, isIdentityStatus } from "./access";
import type { SessionClaims } from "./claims";

const active: SessionClaims = {
  sub: "user-1",
  email: "a@example.test",
  aal: "aal1",
};

describe("decideAccess", () => {
  it("denies without claims", () => {
    expect(decideAccess({ claims: null, status: "active" })).toEqual({
      allowed: false,
      reason: "unauthenticated",
      status: 401,
    });
  });

  it("denies claims without a subject", () => {
    expect(
      decideAccess({ claims: { email: "a@b.test" }, status: "active" }),
    ).toMatchObject({ reason: "unauthenticated", status: 401 });
  });

  it("allows an active identity on a normal route", () => {
    expect(decideAccess({ claims: active, status: "active" })).toEqual({
      allowed: true,
      userId: "user-1",
    });
  });

  it.each(["suspended", "blocked"] as const)(
    "denies a %s identity with a valid token",
    (status) => {
      expect(decideAccess({ claims: active, status })).toEqual({
        allowed: false,
        reason: "identity_blocked",
        status: 403,
      });
    },
  );

  it("denies by default when no profile exists", () => {
    expect(decideAccess({ claims: active, status: null })).toMatchObject({
      reason: "identity_blocked",
      status: 403,
    });
  });

  it("requires a second factor on administrative routes", () => {
    expect(
      decideAccess({ claims: active, status: "active", requireMfa: true }),
    ).toEqual({ allowed: false, reason: "mfa_required", status: 403 });
  });

  it.each(["aal2", "aal3"] as const)("accepts %s for MFA routes", (aal) => {
    expect(
      decideAccess({
        claims: { ...active, aal },
        status: "active",
        requireMfa: true,
      }),
    ).toEqual({ allowed: true, userId: "user-1" });
  });

  it("reports a blocked administrator as blocked, not as missing MFA", () => {
    expect(
      decideAccess({ claims: active, status: "blocked", requireMfa: true }),
    ).toMatchObject({ reason: "identity_blocked" });
  });
});

describe("isIdentityStatus", () => {
  it.each(["active", "suspended", "blocked"])("accepts %s", (value) => {
    expect(isIdentityStatus(value)).toBe(true);
  });

  it.each(["ACTIVE", "", "unknown", null, undefined, 1])(
    "rejects %s",
    (value) => {
      expect(isIdentityStatus(value)).toBe(false);
    },
  );
});
