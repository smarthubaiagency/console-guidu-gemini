import { describe, expect, it } from "vitest";

import {
  normalizeHost,
  partnerHostOrigin,
  partnerSubdomainBase,
  platformHosts,
  requestHost,
  subdomainHost,
} from "./hosts";

describe("normalizeHost", () => {
  it("lowercases and strips the port and a trailing dot", () => {
    expect(normalizeHost("App.Agencia-B.com.br:443")).toBe(
      "app.agencia-b.com.br",
    );
    expect(normalizeHost("localhost:3000")).toBe("localhost");
    expect(normalizeHost("guidu.com.br.")).toBe("guidu.com.br");
  });

  it("rejects values that are not a plain hostname", () => {
    for (const value of [
      null,
      undefined,
      "",
      "   ",
      "[::1]:3000",
      "user@guidu.com.br",
      "guidu.com.br/path",
      "-bad.example.com",
      "a..b.com",
      "x".repeat(300),
    ]) {
      expect(normalizeHost(value)).toBeNull();
    }
  });
});

describe("platformHosts", () => {
  it("includes the APP_URL host and PLATFORM_HOSTS entries", () => {
    const hosts = platformHosts({
      APP_URL: "https://console.guidu.com.br",
      PLATFORM_HOSTS: " guidu.com.br , WWW.guidu.com.br,invalid host ",
      NODE_ENV: "production",
    });
    expect([...hosts].sort()).toEqual([
      "console.guidu.com.br",
      "guidu.com.br",
      "www.guidu.com.br",
    ]);
  });

  it("adds loopback names only outside production", () => {
    expect(platformHosts({ NODE_ENV: "development" }).has("localhost")).toBe(
      true,
    );
    expect(platformHosts({ NODE_ENV: "production" }).has("localhost")).toBe(
      false,
    );
  });

  it("ignores an invalid APP_URL", () => {
    expect(
      platformHosts({ APP_URL: "not a url", NODE_ENV: "production" }).size,
    ).toBe(0);
  });
});

describe("partnerHostOrigin", () => {
  it("always uses https in production", () => {
    expect(
      partnerHostOrigin("app.agencia-b.com.br", {
        NODE_ENV: "production",
        APP_URL: "http://localhost:3000",
      }),
    ).toBe("https://app.agencia-b.com.br");
  });

  it("reuses the APP_URL scheme and port outside production", () => {
    expect(
      partnerHostOrigin("agencia.localhost", {
        NODE_ENV: "development",
        APP_URL: "http://localhost:3000",
      }),
    ).toBe("http://agencia.localhost:3000");
  });
});

describe("partner subdomains", () => {
  it("uses PARTNER_SUBDOMAIN_BASE, or localhost outside production", () => {
    expect(
      partnerSubdomainBase({
        PARTNER_SUBDOMAIN_BASE: "Guidu.com.br",
        NODE_ENV: "production",
      }),
    ).toBe("guidu.com.br");
    expect(partnerSubdomainBase({ NODE_ENV: "development" })).toBe("localhost");
    expect(partnerSubdomainBase({ NODE_ENV: "production" })).toBeNull();
  });

  it("builds the host from the name or accepts the full host under the base", () => {
    expect(subdomainHost(" Agencia ", "guidu.com.br")).toBe(
      "agencia.guidu.com.br",
    );
    expect(subdomainHost("agencia.guidu.com.br", "guidu.com.br")).toBe(
      "agencia.guidu.com.br",
    );
    expect(subdomainHost("agencia", "localhost")).toBe("agencia.localhost");
  });

  it("refuses nested names, other domains and invalid labels", () => {
    for (const value of [
      "app.agencia",
      "agencia.outro.com.br",
      "-agencia",
      "agência",
      "",
      "a".repeat(64),
    ]) {
      expect(subdomainHost(value, "guidu.com.br")).toBeNull();
    }
  });
});

describe("requestHost", () => {
  const from = (headers: Record<string, string>) => (name: string) =>
    headers[name];

  it("prefers the first X-Forwarded-Host value over Host", () => {
    expect(
      requestHost(
        from({
          host: "localhost:3000",
          "x-forwarded-host": "agencia.localhost:3000, proxy.internal",
        }),
      ),
    ).toBe("agencia.localhost:3000");
  });

  it("falls back to Host", () => {
    expect(requestHost(from({ host: "agencia.localhost:3000" }))).toBe(
      "agencia.localhost:3000",
    );
    expect(requestHost(from({ host: "x.test", "x-forwarded-host": " " }))).toBe(
      "x.test",
    );
    expect(requestHost(from({}))).toBeNull();
  });
});
