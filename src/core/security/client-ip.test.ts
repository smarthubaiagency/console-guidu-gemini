import { describe, expect, it } from "vitest";

import { parseAllowlist, parseCidr } from "./allowlist";
import { clientIp, normalizeIp, trustedProxyHops } from "./client-ip";

const headers =
  (values: Record<string, string>) =>
  (name: string): string | null =>
    values[name] ?? null;

describe("client IP behind Traefik (CF5a)", () => {
  it("takes the address Traefik appended", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
    // Whatever the client wrote before it is ignored.
    expect(
      clientIp(headers({ "x-forwarded-for": "10.0.0.1, 198.51.100.4" })),
    ).toBe("198.51.100.4");
  });

  it("counts the trusted proxies from the right", () => {
    const get = headers({
      "x-forwarded-for": "10.0.0.1, 203.0.113.7, 172.70.1.1",
    });
    expect(clientIp(get, 2)).toBe("203.0.113.7");
    expect(clientIp(get, 9)).toBe("10.0.0.1");
  });

  it("returns null without a usable address", () => {
    expect(clientIp(headers({}))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": " , " }))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": "unknown" }))).toBeNull();
  });

  it("normalizes the forms an address arrives in", () => {
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("203.0.113.7:8080")).toBe("203.0.113.7");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("300.1.1.1")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });

  it("reads TRUSTED_PROXY_HOPS between 1 and 5", () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops("2")).toBe(2);
    expect(trustedProxyHops("0")).toBe(1);
    expect(trustedProxyHops("9")).toBe(1);
    expect(trustedProxyHops("x")).toBe(1);
  });
});

describe("IP allow list entries (CF5a)", () => {
  it("accepts addresses and blocks of both families", () => {
    expect(parseCidr("203.0.113.7")).toBe("203.0.113.7/32");
    expect(parseCidr("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(parseCidr("2001:DB8::/32")).toBe("2001:db8::/32");
    expect(parseCidr("::1")).toBe("::1/128");
  });

  it("refuses anything else", () => {
    for (const entry of [
      "203.0.113.0/33",
      "2001:db8::/129",
      "203.0.113.7/",
      "203.0.113.7/24/1",
      "example.com",
      "203.0.113.7:80",
      "1.2.3",
    ]) {
      expect(parseCidr(entry), entry).toBeNull();
    }
  });

  it("splits lines, commas and spaces and drops repeats", () => {
    expect(
      parseAllowlist("203.0.113.7\n198.51.100.0/24, 203.0.113.7  ::1"),
    ).toEqual({
      ok: true,
      entries: ["203.0.113.7/32", "198.51.100.0/24", "::1/128"],
    });
    expect(parseAllowlist("  ")).toEqual({ ok: true, entries: [] });
  });

  it("names the invalid entries and caps the size", () => {
    expect(parseAllowlist("203.0.113.7 nope 10.0.0.0/40")).toEqual({
      ok: false,
      reason: "invalid",
      invalid: ["nope", "10.0.0.0/40"],
    });
    const many = Array.from({ length: 51 }, (_, i) => `10.0.0.${i}`).join("\n");
    expect(parseAllowlist(many)).toEqual({ ok: false, reason: "too_many" });
  });
});
