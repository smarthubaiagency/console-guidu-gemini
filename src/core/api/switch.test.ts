import { describe, expect, it, vi } from "vitest";

import {
  API_SWITCHES_ON,
  apiDisabledResponse,
  createApiSwitchReader,
  queryApiSwitches,
} from "./switch";

describe("API emergency switches (CF6b)", () => {
  it("reads the platform rows; a missing row is on", async () => {
    const client = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ key: "api.mcp_enabled", value: false }]),
    };
    await expect(queryApiSwitches(client as never)).resolves.toEqual({
      api: true,
      mcp: false,
    });
  });

  it("caches the answer and keeps the last good one when a read fails", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ api: false, mcp: true })
      .mockRejectedValueOnce(new Error("down"));
    const onError = vi.fn();
    const reader = createApiSwitchReader({ load, ttlMs: 0, onError });
    await expect(reader.switches()).resolves.toEqual({ api: false, mcp: true });
    await expect(reader.switches()).resolves.toEqual({ api: false, mcp: true });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("counts as on without any good answer", async () => {
    const reader = createApiSwitchReader({
      load: () => Promise.reject(new Error("down")),
    });
    await expect(reader.switches()).resolves.toEqual(API_SWITCHES_ON);
  });

  it("answers 503 in English only for the surface turned off", async () => {
    expect(apiDisabledResponse(API_SWITCHES_ON, "api", "r1")).toBeNull();
    const response = apiDisabledResponse(
      { api: true, mcp: false },
      "mcp",
      "r2",
    );
    expect(response?.status).toBe(503);
    const body = await response?.json();
    expect(body.error.code).toBe("service_disabled");
    expect(body.error.message).toMatch(/turned off/);
    expect(body.error.requestId).toBe("r2");
  });
});
