import { describe, expect, it, vi } from "vitest";

import type { CloudflareClient } from "./cloudflare";
import { checkDomain, type DomainCheckDeps } from "./verify";

const TARGET = "proxy.guidu.test";

function deps(
  over: Partial<DomainCheckDeps> & { cnames?: string[] } = {},
): DomainCheckDeps {
  return {
    cnameTarget: TARGET,
    cloudflare: null,
    resolveCname: async () => over.cnames ?? [`${TARGET}.`],
    ...over,
  };
}

function cloudflare(ssl: "pending" | "active" | "error"): CloudflareClient {
  return {
    upsert: vi.fn(async () => ({ id: "cf-1", ssl })),
    refresh: vi.fn(async (id: string) => ({ id, ssl })),
    remove: vi.fn(async () => undefined),
  };
}

const none = { cloudflareHostnameId: null };

describe("checkDomain", () => {
  it("stays pending without a CNAME target", async () => {
    const result = await checkDomain("perfil.loja.test", none, {
      ...deps(),
      cnameTarget: null,
    });
    expect(result).toMatchObject({
      status: "pending",
      lastError: "not_configured",
    });
  });

  it("waits for the CNAME, also when the lookup fails", async () => {
    expect(
      await checkDomain("perfil.loja.test", none, deps({ cnames: ["x.test"] })),
    ).toMatchObject({ status: "pending", lastError: "dns_pending" });
    expect(
      await checkDomain("perfil.loja.test", none, {
        ...deps(),
        resolveCname: async () => {
          throw new Error("ENODATA");
        },
      }),
    ).toMatchObject({ status: "pending", lastError: "dns_pending" });
  });

  it("activates on DNS alone without Cloudflare", async () => {
    expect(await checkDomain("perfil.loja.test", none, deps())).toEqual({
      status: "active",
      sslStatus: "none",
      cloudflareHostnameId: null,
      lastError: null,
    });
  });

  it("creates the hostname and waits for the certificate", async () => {
    const client = cloudflare("pending");
    const result = await checkDomain(
      "perfil.loja.test",
      none,
      deps({ cloudflare: client }),
    );
    expect(client.upsert).toHaveBeenCalledWith("perfil.loja.test");
    expect(result).toEqual({
      status: "pending",
      sslStatus: "pending",
      cloudflareHostnameId: "cf-1",
      lastError: "ssl_pending",
    });
  });

  it("refreshes a known hostname and activates with the certificate", async () => {
    const client = cloudflare("active");
    const result = await checkDomain(
      "perfil.loja.test",
      { cloudflareHostnameId: "cf-9" },
      deps({ cloudflare: client }),
    );
    expect(client.refresh).toHaveBeenCalledWith("cf-9");
    expect(result).toMatchObject({
      status: "active",
      sslStatus: "active",
      cloudflareHostnameId: "cf-9",
    });
  });

  it("reports a Cloudflare failure without activating", async () => {
    const client = cloudflare("active");
    vi.mocked(client.upsert).mockRejectedValue(new Error("boom"));
    expect(
      await checkDomain("perfil.loja.test", none, deps({ cloudflare: client })),
    ).toMatchObject({ status: "pending", lastError: "cloudflare_error" });
  });
});
