import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { headers } = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
const { prisma } = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn() },
}));
vi.mock("@/lib/prisma/client", () => ({ prisma }));

import { HOUSE_PARTNER_ID } from "./constants";
import { getRequestOrigin, resolvePartnerForHost } from "./resolve";

function fakeClient(rows: Array<{ partner_id: string }>) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  return {
    client: { $queryRaw: queryRaw } as unknown as PrismaClient,
    queryRaw,
  };
}

describe("resolvePartnerForHost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps platform hosts to the house partner without a query", async () => {
    vi.stubEnv("APP_URL", "https://console.guidu.com.br");
    const { client, queryRaw } = fakeClient([]);

    await expect(
      resolvePartnerForHost(client, "console.guidu.com.br:443"),
    ).resolves.toEqual({
      partnerId: HOUSE_PARTNER_ID,
      host: "console.guidu.com.br",
      isPlatformHost: true,
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("maps an active partner domain to that partner", async () => {
    vi.stubEnv("APP_URL", "https://console.guidu.com.br");
    const partnerId = "b0000000-0000-4000-8000-000000000001";
    const { client } = fakeClient([{ partner_id: partnerId }]);

    await expect(
      resolvePartnerForHost(client, "App.Agencia-B.com.br"),
    ).resolves.toEqual({
      partnerId,
      host: "app.agencia-b.com.br",
      isPlatformHost: false,
    });
  });

  it("returns null for unknown or malformed hosts", async () => {
    vi.stubEnv("APP_URL", "https://console.guidu.com.br");
    const { client, queryRaw } = fakeClient([]);

    await expect(
      resolvePartnerForHost(client, "unknown.example.com"),
    ).resolves.toBeNull();
    await expect(resolvePartnerForHost(client, "[::1]")).resolves.toBeNull();
    await expect(resolvePartnerForHost(client, null)).resolves.toBeNull();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("getRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function requestFrom(host: string) {
    headers.mockResolvedValue(new Headers({ host }));
  }

  it("uses APP_URL on platform hosts", async () => {
    vi.stubEnv("APP_URL", "https://console.guidu.com.br");
    requestFrom("console.guidu.com.br");
    await expect(getRequestOrigin()).resolves.toBe(
      "https://console.guidu.com.br",
    );
  });

  it("uses https and the verified host on partner domains", async () => {
    vi.stubEnv("APP_URL", "https://console.guidu.com.br");
    prisma.$queryRaw.mockResolvedValueOnce([
      { partner_id: "b0000000-0000-4000-8000-000000000001" },
    ]);
    requestFrom("app.agencia-b.com.br:8443");
    await expect(getRequestOrigin()).resolves.toBe(
      "https://app.agencia-b.com.br",
    );
  });

  it("returns null for unknown hosts", async () => {
    vi.stubEnv("APP_URL", "https://console.guidu.com.br");
    prisma.$queryRaw.mockResolvedValueOnce([]);
    requestFrom("evil.example.com");
    await expect(getRequestOrigin()).resolves.toBeNull();
  });
});
