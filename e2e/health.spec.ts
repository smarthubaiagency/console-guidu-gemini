/**
 * ============================================================================
 * File: e2e/health.spec.ts
 * Module: End-to-End Tests for the web probes (F3d)
 *
 * Maintenance Rationale:
 * - /api/health/live answers without touching the database.
 * - /api/health/ready answers 200 while the database answers, with the
 *   status of each check and nothing else; neither is cached.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

test("the web answers its liveness and readiness probes", async ({
  request,
}) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });
  expect(live.headers()["cache-control"]).toContain("no-store");

  const ready = await request.get("/api/health/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({
    status: "ok",
    checks: { database: "ok" },
  });
});
