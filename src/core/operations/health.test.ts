import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { startHealthServer } from "@/worker/health";
import type { WorkerHealth } from "@/worker/runtime";

import { checkReadiness } from "./health";
import { ageLabel, durationLabel, workerState } from "./service";

describe("checkReadiness", () => {
  it("is ready when the database answers", async () => {
    const client = { $queryRaw: async () => [{ ok: 1 }] } as never;
    expect(await checkReadiness(client)).toMatchObject({
      ready: true,
      checks: { database: "ok" },
    });
  });

  it("is not ready when the query fails or takes too long", async () => {
    const failing = {
      $queryRaw: async () => {
        throw new Error("connection refused");
      },
    } as never;
    expect((await checkReadiness(failing)).ready).toBe(false);
    const slow = { $queryRaw: () => new Promise(() => undefined) } as never;
    expect(await checkReadiness(slow, 20)).toMatchObject({
      ready: false,
      checks: { database: "fail" },
    });
  });
});

describe("worker probes", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("answers live always and ready only when the worker is ready", async () => {
    let ready = false;
    const health = (): WorkerHealth => ({
      live: true,
      ready,
      instanceName: "w1",
      lastDatabaseOkAt: null,
    });
    server = await startHealthServer(0, health, "127.0.0.1");
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);

    expect((await get("/health/live")).status).toBe(200);
    const notReady = await get("/health/ready");
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ status: "unavailable" });
    ready = true;
    expect((await get("/health/ready")).status).toBe(200);
    expect((await get("/other")).status).toBe(404);
  });
});

describe("operations labels", () => {
  const now = new Date("2026-10-16T12:00:00Z");

  it("tells online, stopped and silent workers apart", () => {
    expect(
      workerState(
        { status: "running", lastSeenAt: new Date("2026-10-16T11:59:00Z") },
        now,
      ),
    ).toBe("online");
    expect(
      workerState(
        { status: "running", lastSeenAt: new Date("2026-10-16T11:55:00Z") },
        now,
      ),
    ).toBe("silent");
    expect(workerState({ status: "stopped", lastSeenAt: now }, now)).toBe(
      "stopped",
    );
  });

  it("formats ages and durations", () => {
    expect(ageLabel(new Date("2026-10-16T11:59:30Z"), now)).toBe("há 30 s");
    expect(ageLabel(new Date("2026-10-16T09:00:00Z"), now)).toBe("há 3 h");
    expect(durationLabel(null)).toBe("—");
    expect(durationLabel(820)).toBe("820 ms");
    expect(durationLabel(3400)).toBe("3,4 s");
  });
});
