import { describe, expect, it } from "vitest";

import { maintenanceApiResponse } from "./api";
import { evaluateMaintenance } from "./state";

const NOW = new Date("2026-11-20T15:00:00Z");

describe("maintenanceApiResponse (CF5c)", () => {
  it("answers 503 with Retry-After in full maintenance", async () => {
    const status = evaluateMaintenance(
      {
        mode: "maintenance",
        startsAt: null,
        endsAt: new Date("2026-11-20T15:10:00Z"),
        messages: {},
      },
      NOW,
    );
    const response = maintenanceApiResponse(status, "GET", "req-1", NOW);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("600");
    expect(response?.headers.get("x-request-id")).toBe("req-1");
    const body = (await response?.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error).toEqual({
      code: "maintenance",
      message: "GUIDU is under maintenance. Try again later.",
      requestId: "req-1",
    });
  });

  it("refuses only writes in read-only", async () => {
    const status = evaluateMaintenance(
      { mode: "read_only", startsAt: null, endsAt: null, messages: {} },
      NOW,
    );
    expect(maintenanceApiResponse(status, "GET", "r", NOW)).toBeNull();
    const response = maintenanceApiResponse(status, "POST", "r", NOW);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("600");
    const body = (await response?.json()) as { error: { code: string } };
    expect(body.error.code).toBe("read_only");
  });

  it("lets everything through with no window in force", () => {
    expect(
      maintenanceApiResponse({ phase: "off" }, "POST", "r", NOW),
    ).toBeNull();
  });
});
