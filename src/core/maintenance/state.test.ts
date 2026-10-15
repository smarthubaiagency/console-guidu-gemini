import { describe, expect, it } from "vitest";

import {
  activeMode,
  apiRefusal,
  dateToZonedLocal,
  DEFAULT_RETRY_AFTER_SECONDS,
  evaluateMaintenance,
  isClosedPath,
  maintenanceMessage,
  type MaintenanceWindow,
  retryAfterSeconds,
  zonedLocalToDate,
} from "./state";

const NOW = new Date("2026-11-20T15:00:00Z");
const at = (iso: string) => new Date(iso);
const windowWith = (
  over: Partial<MaintenanceWindow> = {},
): MaintenanceWindow => ({
  mode: "maintenance",
  startsAt: null,
  endsAt: null,
  messages: {},
  ...over,
});

describe("evaluateMaintenance (CF5c)", () => {
  it("is off without a window or after its end", () => {
    expect(evaluateMaintenance(null, NOW)).toEqual({ phase: "off" });
    expect(
      evaluateMaintenance(
        windowWith({ endsAt: at("2026-11-20T15:00:00Z") }),
        NOW,
      ).phase,
    ).toBe("off");
  });

  it("is active without a start, or once the start has passed", () => {
    expect(evaluateMaintenance(windowWith(), NOW).phase).toBe("active");
    const status = evaluateMaintenance(
      windowWith({
        mode: "read_only",
        startsAt: at("2026-11-20T14:00:00Z"),
        endsAt: at("2026-11-20T16:00:00Z"),
      }),
      NOW,
    );
    expect(status.phase).toBe("active");
    expect(activeMode(status)).toBe("read_only");
  });

  it("is scheduled before the start, with the notice in the last 24 hours", () => {
    const soon = evaluateMaintenance(
      windowWith({ startsAt: at("2026-11-21T02:00:00Z") }),
      NOW,
    );
    expect(soon).toMatchObject({ phase: "scheduled", notice: true });
    expect(activeMode(soon)).toBeNull();
    const later = evaluateMaintenance(
      windowWith({ startsAt: at("2026-11-22T15:00:01Z") }),
      NOW,
    );
    expect(later).toMatchObject({ phase: "scheduled", notice: false });
  });
});

describe("retryAfterSeconds", () => {
  it("counts down to the end, at least 30 seconds", () => {
    const status = evaluateMaintenance(
      windowWith({ endsAt: at("2026-11-20T15:20:00Z") }),
      NOW,
    );
    expect(retryAfterSeconds(status, NOW)).toBe(1200);
    const ending = evaluateMaintenance(
      windowWith({ endsAt: at("2026-11-20T15:00:05Z") }),
      NOW,
    );
    expect(retryAfterSeconds(ending, NOW)).toBe(30);
  });

  it("uses the default without an end", () => {
    expect(retryAfterSeconds(evaluateMaintenance(windowWith(), NOW), NOW)).toBe(
      DEFAULT_RETRY_AFTER_SECONDS,
    );
  });
});

describe("apiRefusal", () => {
  const full = evaluateMaintenance(windowWith(), NOW);
  const readOnly = evaluateMaintenance(windowWith({ mode: "read_only" }), NOW);
  const scheduled = evaluateMaintenance(
    windowWith({ startsAt: at("2026-11-20T16:00:00Z") }),
    NOW,
  );

  it("closes every call in full maintenance", () => {
    expect(apiRefusal(full, "GET")).toBe("maintenance");
    expect(apiRefusal(full, "POST")).toBe("maintenance");
  });

  it("refuses only the writes in read-only", () => {
    expect(apiRefusal(readOnly, "GET")).toBeNull();
    expect(apiRefusal(readOnly, "head")).toBeNull();
    expect(apiRefusal(readOnly, "POST")).toBe("read_only");
    expect(apiRefusal(readOnly, "PATCH")).toBe("read_only");
    expect(apiRefusal(readOnly, "DELETE")).toBe("read_only");
  });

  it("lets everything through before the start", () => {
    expect(apiRefusal(scheduled, "POST")).toBeNull();
  });
});

describe("isClosedPath", () => {
  it("closes /app, /admin and the invitations", () => {
    for (const path of [
      "/app",
      "/app/acme",
      "/app/acme/crm",
      "/app/account/language",
      "/admin",
      "/admin/settings/security",
      "/invite/abc",
      "/partner-invite/abc",
    ]) {
      expect(isClosedPath(path), path).toBe(true);
    }
  });

  it("keeps /platform, the MFA enrolment and the identity pages open", () => {
    for (const path of [
      null,
      "",
      "/",
      "/platform",
      "/platform/operations/maintenance",
      "/app/account/security",
      "/login",
      "/auth/mfa",
      "/maintenance",
      "/application",
      "/administrator",
    ]) {
      expect(isClosedPath(path), String(path)).toBe(false);
    }
  });
});

describe("maintenanceMessage", () => {
  it("falls back to Portuguese, then to none", () => {
    const messages = { "pt-BR": "Volta às 23h.", es: "Vuelve a las 23 h." };
    expect(maintenanceMessage(messages, "es")).toBe("Vuelve a las 23 h.");
    expect(maintenanceMessage(messages, "en")).toBe("Volta às 23h.");
    expect(maintenanceMessage({ en: "Back soon." }, "pt-BR")).toBeNull();
    expect(maintenanceMessage({}, "en")).toBeNull();
  });
});

describe("zonedLocalToDate", () => {
  it("reads the form's local time in the time zone", () => {
    expect(
      zonedLocalToDate("2026-11-20T23:00", "America/Sao_Paulo")?.toISOString(),
    ).toBe("2026-11-21T02:00:00.000Z");
    expect(zonedLocalToDate("2026-07-01T09:30", "UTC")?.toISOString()).toBe(
      "2026-07-01T09:30:00.000Z",
    );
    // Daylight saving time elsewhere: New York in July is UTC-4.
    expect(
      zonedLocalToDate("2026-07-01T09:30", "America/New_York")?.toISOString(),
    ).toBe("2026-07-01T13:30:00.000Z");
  });

  it("refuses an empty or invalid value", () => {
    for (const value of [
      "",
      "amanhã",
      "2026-02-30T10:00",
      "2026-11-20 23:00",
    ]) {
      expect(zonedLocalToDate(value, "America/Sao_Paulo"), value).toBeNull();
    }
  });

  it("round-trips with dateToZonedLocal", () => {
    const date = zonedLocalToDate("2026-11-20T23:00", "America/Sao_Paulo")!;
    expect(dateToZonedLocal(date, "America/Sao_Paulo")).toBe(
      "2026-11-20T23:00",
    );
  });
});
