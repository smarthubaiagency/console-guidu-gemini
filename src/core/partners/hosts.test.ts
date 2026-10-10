import { describe, expect, it } from "vitest";

import { normalizeHost, platformHosts } from "./hosts";

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
