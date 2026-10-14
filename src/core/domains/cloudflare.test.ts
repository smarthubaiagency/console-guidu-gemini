import { describe, expect, it, vi } from "vitest";

import { cloudflareClient, sslStatusOf } from "./cloudflare";
import { domainsConfig } from "./config";

const config = {
  token: "token-de-teste",
  zoneId: "zone",
  apiBase: "https://cf.test/client/v4",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("cloudflareClient", () => {
  it("creates a hostname with a DV certificate over HTTP", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ success: true, result: [] }))
      .mockResolvedValueOnce(
        reply({
          success: true,
          result: { id: "cf-1", ssl: { status: "pending_validation" } },
        }),
      );
    const client = cloudflareClient(config, fetchMock as typeof fetch);
    expect(await client.upsert("perfil.loja.test")).toEqual({
      id: "cf-1",
      ssl: "pending",
    });
    const [listUrl, listInit] = fetchMock.mock.calls[0]!;
    expect(listUrl).toBe(
      "https://cf.test/client/v4/zones/zone/custom_hostnames?hostname=perfil.loja.test",
    );
    expect(listInit.headers.Authorization).toBe("Bearer token-de-teste");
    const [, createInit] = fetchMock.mock.calls[1]!;
    expect(createInit.method).toBe("POST");
    expect(JSON.parse(createInit.body)).toEqual({
      hostname: "perfil.loja.test",
      ssl: { method: "http", type: "dv", settings: { http2: "on" } },
    });
  });

  it("revalidates an existing hostname without a certificate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          success: true,
          result: [{ id: "cf-2", ssl: { status: "timed_out" } }],
        }),
      )
      .mockResolvedValueOnce(
        reply({
          success: true,
          result: { id: "cf-2", ssl: { status: "pending_issuance" } },
        }),
      );
    const client = cloudflareClient(config, fetchMock as typeof fetch);
    expect(await client.upsert("perfil.loja.test")).toEqual({
      id: "cf-2",
      ssl: "pending",
    });
    expect(fetchMock.mock.calls[1]![1].method).toBe("PATCH");
  });

  it("throws on an API error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reply({ success: false, errors: [] }, 403));
    const client = cloudflareClient(config, fetchMock as typeof fetch);
    await expect(client.refresh("cf-3")).rejects.toThrow("403");
  });

  it("folds the certificate states", () => {
    expect(sslStatusOf("active")).toBe("active");
    expect(sslStatusOf("initializing")).toBe("pending");
    expect(sslStatusOf("expired")).toBe("error");
    expect(sslStatusOf(undefined)).toBe("pending");
  });
});

describe("domainsConfig", () => {
  it("needs token and zone for Cloudflare and a long secret", () => {
    expect(
      domainsConfig({
        CUSTOM_DOMAIN_CNAME_TARGET: "Proxy.Guidu.test.",
        CLOUDFLARE_API_TOKEN: "t",
        DOMAINS_CHECK_SECRET: "curto",
      }),
    ).toEqual({
      cnameTarget: "proxy.guidu.test",
      cloudflare: null,
      checkSecret: null,
    });
    expect(
      domainsConfig({
        CLOUDFLARE_API_TOKEN: "t",
        CLOUDFLARE_ZONE_ID: "z",
        DOMAINS_CHECK_SECRET: "0123456789abcdef",
      }),
    ).toMatchObject({
      cnameTarget: null,
      cloudflare: {
        token: "t",
        zoneId: "z",
        apiBase: "https://api.cloudflare.com/client/v4",
      },
      checkSecret: "0123456789abcdef",
    });
  });
});
