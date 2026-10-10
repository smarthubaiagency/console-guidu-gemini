import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/prisma/client", () => ({ prisma: {} }));

import { HOUSE_PARTNER_ID } from "./constants";
import { resolvePartnerForHost } from "./resolve";

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
