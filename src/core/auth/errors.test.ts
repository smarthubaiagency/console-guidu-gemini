import { describe, expect, it } from "vitest";

import { AccessDeniedError, isAccessDeniedError } from "./errors";

describe("AccessDeniedError", () => {
  it("carries the HTTP status for services", () => {
    expect(new AccessDeniedError("unauthenticated", 401).status).toBe(401);
    expect(new AccessDeniedError("mfa_required", 403).status).toBe(403);
  });

  it("routes an anonymous visitor to login with the requested page", () => {
    expect(
      new AccessDeniedError("unauthenticated", 401).route("/platform"),
    ).toBe("/login?next=%2Fplatform");
  });

  it("routes a missing factor to the challenge with the requested page", () => {
    expect(new AccessDeniedError("mfa_required", 403).route("/platform")).toBe(
      "/auth/mfa?next=%2Fplatform",
    );
  });

  it("gives a blocked identity nowhere to return to", () => {
    expect(
      new AccessDeniedError("identity_blocked", 403).route("/platform"),
    ).toBe("/auth/suspended");
  });

  it("is recognisable across module boundaries", () => {
    expect(
      isAccessDeniedError(new AccessDeniedError("mfa_required", 403)),
    ).toBe(true);
    expect(isAccessDeniedError(new Error("other"))).toBe(false);
  });
});
