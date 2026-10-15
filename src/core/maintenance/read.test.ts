import { describe, expect, it, vi } from "vitest";

import { createMaintenanceReader } from "./read";
import type { MaintenanceWindow } from "./state";

const FULL: MaintenanceWindow = {
  mode: "maintenance",
  startsAt: null,
  endsAt: null,
  messages: {},
};

describe("createMaintenanceReader (CF5c)", () => {
  it("reads once per cache period and again after invalidate", async () => {
    const load = vi.fn(async () => FULL);
    const reader = createMaintenanceReader({ load, ttlMs: 60_000 });
    expect((await reader.status()).phase).toBe("active");
    expect((await reader.status()).phase).toBe("active");
    expect(load).toHaveBeenCalledTimes(1);
    reader.invalidate();
    await reader.status();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent callers", async () => {
    let release: (value: MaintenanceWindow | null) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<MaintenanceWindow | null>((resolve) => {
          release = resolve;
        }),
    );
    const reader = createMaintenanceReader({ load, ttlMs: 60_000 });
    const both = Promise.all([reader.status(), reader.status()]);
    release(null);
    expect((await both).map((s) => s.phase)).toEqual(["off", "off"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("fails open: the last good answer, else no window", async () => {
    const onError = vi.fn();
    const failing = createMaintenanceReader({
      load: async () => {
        throw new Error("database down");
      },
      ttlMs: 0,
      onError,
    });
    expect((await failing.status()).phase).toBe("off");
    expect(onError).toHaveBeenCalledTimes(1);

    let fail = false;
    const flaky = createMaintenanceReader({
      load: async () => {
        if (fail) throw new Error("database down");
        return FULL;
      },
      ttlMs: 0,
    });
    expect((await flaky.status()).phase).toBe("active");
    fail = true;
    expect((await flaky.status()).phase).toBe("active");
  });

  it("evaluates the schedule at each call, even from the cache", async () => {
    let now = new Date("2026-11-20T15:00:00Z");
    const reader = createMaintenanceReader({
      load: async () => ({
        ...FULL,
        startsAt: new Date("2026-11-20T15:00:03Z"),
        endsAt: new Date("2026-11-20T15:00:06Z"),
      }),
      ttlMs: 60_000,
      now: () => now,
    });
    expect((await reader.status()).phase).toBe("scheduled");
    now = new Date("2026-11-20T15:00:04Z");
    expect((await reader.status()).phase).toBe("active");
    now = new Date("2026-11-20T15:00:07Z");
    expect((await reader.status()).phase).toBe("off");
  });
});
