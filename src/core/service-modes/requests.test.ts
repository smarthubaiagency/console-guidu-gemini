import { describe, expect, it } from "vitest";

import { AppError } from "@/shared/errors";

import {
  canTransition,
  consoleUrlOf,
  decisionOutcome,
  generateServiceModeToken,
  hashServiceModeToken,
  linkUrlOf,
  requestExpiresAt,
  requestSituation,
  SERVICE_MODE_REQUEST_STATUSES,
  serviceModeError,
  settingsUrlOf,
  tokenHashOf,
} from "./requests";

describe("service mode requests (GB1c)", () => {
  it("draws a 256-bit token and keeps only its SHA-256", () => {
    const a = generateServiceModeToken();
    const b = generateServiceModeToken();
    expect(a.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(hashServiceModeToken(a.rawToken));
    expect(a.tokenHash).not.toBe(a.rawToken);
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(tokenHashOf(a.rawToken.toUpperCase())).toBe(a.tokenHash);
    expect(tokenHashOf("curto")).toBeNull();
    expect(tokenHashOf(`${a.rawToken}x`)).toBeNull();
    expect(tokenHashOf(null)).toBeNull();
  });

  it("is valid for 7 days and reads as expired after them", () => {
    const created = new Date("2026-10-16T12:00:00Z");
    const expires = requestExpiresAt(created);
    expect(expires.toISOString()).toBe("2026-10-23T12:00:00.000Z");
    expect(
      requestSituation("pending", expires, new Date("2026-10-23T11:59:59Z")),
    ).toBe("pending");
    expect(
      requestSituation("pending", expires, new Date("2026-10-23T12:00:00Z")),
    ).toBe("expired");
    // A decided request keeps its decision after the date.
    expect(requestSituation("approved", expires, new Date("2027-01-01"))).toBe(
      "approved",
    );
    expect(requestSituation("bogus", expires, created)).toBe("expired");
  });

  it("moves only from pending, once", () => {
    for (const to of SERVICE_MODE_REQUEST_STATUSES) {
      expect(canTransition("pending", to)).toBe(to !== "pending");
      for (const from of SERVICE_MODE_REQUEST_STATUSES.filter(
        (s) => s !== "pending",
      )) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("reads the outcome of a decision, unknown as not found", () => {
    expect(decisionOutcome("approved")).toBe("approved");
    expect(decisionOutcome("already_decided")).toBe("already_decided");
    expect(decisionOutcome("whatever")).toBe("not_found");
    expect(decisionOutcome(null)).toBe("not_found");
  });

  it("turns the database codes into translated errors", () => {
    const error = serviceModeError(
      new Error(
        "Raw query failed. Code: `P0001`. Message: `service_mode:pending_exists`",
      ),
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error?.code).toBe("conflict");
    expect(error?.messageKey).toBe("serviceMode.errors.pendingExists");
    expect(serviceModeError(new Error("service_mode:forbidden"))?.code).toBe(
      "forbidden",
    );
    expect(serviceModeError(new Error("other"))).toBeNull();
  });

  it("builds the links on the host where the request was made", () => {
    expect(settingsUrlOf("https://painel.agencia.test/", "loja")).toBe(
      "https://painel.agencia.test/app/loja/settings/service-mode",
    );
    expect(consoleUrlOf("https://painel.agencia.test", "partner")).toBe(
      "https://painel.agencia.test/admin/customers",
    );
    expect(consoleUrlOf("https://app.guidu.test", "platform")).toBe(
      "https://app.guidu.test/platform/customers",
    );
    expect(linkUrlOf("https://painel.agencia.test", "ab")).toBe(
      "https://painel.agencia.test/service-mode/ab",
    );
  });
});
