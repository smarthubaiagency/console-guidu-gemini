import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "@/core/security/headers";

import {
  analyticsClientConfig,
  analyticsConnectOrigin,
  type AnalyticsValues,
  isValidSiteId,
} from "./config";

const OFF: AnalyticsValues = {
  enabled: false,
  provider: "plausible",
  siteId: "painel.guidu.co",
  posthogRegion: "us",
  partnerEnabled: true,
  partnerSiteId: "painel.agencia.com",
};
const ON: AnalyticsValues = { ...OFF, enabled: true };
const OPTIONS = { partnerOwn: false, production: true };

describe("analytics configuration (CF7)", () => {
  it("sends nothing while the platform switch is off (the default)", () => {
    expect(analyticsClientConfig(OFF, OPTIONS)).toBeNull();
    expect(
      analyticsClientConfig(OFF, { partnerOwn: true, production: true }),
    ).toBeNull();
    expect(analyticsConnectOrigin(OFF)).toBeNull();
  });

  it("measures every area for the platform and login and /app for the partner", () => {
    const platformHost = analyticsClientConfig(ON, OPTIONS);
    expect(platformHost?.sites).toEqual([
      {
        owner: "platform",
        siteId: "painel.guidu.co",
        areas: ["platform", "admin", "app", "auth", "public"],
      },
    ]);
    expect(platformHost?.requiresConsent).toBe(false);
    expect(platformHost?.debug).toBe(false);
    const partnerHost = analyticsClientConfig(ON, {
      partnerOwn: true,
      production: false,
    });
    expect(partnerHost?.sites[1]).toEqual({
      owner: "partner",
      siteId: "painel.agencia.com",
      areas: ["auth", "app"],
    });
    expect(partnerHost?.debug).toBe(true);
  });

  it("leaves out identifiers that do not fit the provider", () => {
    const posthog = analyticsClientConfig(
      { ...ON, provider: "posthog" },
      { partnerOwn: true, production: true },
    );
    expect(posthog).toBeNull();
    expect(isValidSiteId("posthog", "phc_abcdefghijklmnopqrstuv")).toBe(true);
    expect(isValidSiteId("plausible", "Painel.Guidu.co")).toBe(false);
    expect(isValidSiteId("plausible", "localhost")).toBe(false);
  });

  it("asks consent and posts to the region's host with PostHog", () => {
    const config = analyticsClientConfig(
      {
        ...ON,
        provider: "posthog",
        posthogRegion: "eu",
        siteId: "phc_abcdefghijklmnopqrstuv",
      },
      OPTIONS,
    );
    expect(config?.requiresConsent).toBe(true);
    expect(config?.endpoint).toBe("https://eu.i.posthog.com/i/v0/e/");
  });
});

describe("CSP with product analytics (CF7)", () => {
  const nonce = "bm9uY2U=";
  it("keeps connect-src to self while analytics is off", () => {
    const csp = contentSecurityPolicy(nonce, {
      production: true,
      analyticsOrigin: analyticsConnectOrigin(OFF),
    });
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
  });

  it("opens only the chosen provider's origin, keeping the nonce", () => {
    const plausible = contentSecurityPolicy(nonce, {
      production: true,
      analyticsOrigin: analyticsConnectOrigin(ON),
    });
    expect(plausible).toContain("connect-src 'self' https://plausible.io;");
    expect(plausible).not.toContain("posthog");
    expect(plausible).toContain(`'nonce-${nonce}'`);
    expect(plausible).not.toMatch(/script-src[^;]*plausible/);

    const posthog = contentSecurityPolicy(nonce, {
      production: true,
      analyticsOrigin: analyticsConnectOrigin({
        ...ON,
        provider: "posthog",
      }),
    });
    expect(posthog).toContain("connect-src 'self' https://us.i.posthog.com;");
    expect(posthog).not.toContain("plausible");
  });

  it("ignores an origin that is not a plain https host", () => {
    for (const bad of [
      "http://plausible.io",
      "https://evil.test; script-src *",
      "*",
    ]) {
      expect(
        contentSecurityPolicy(nonce, {
          production: true,
          analyticsOrigin: bad,
        }),
      ).toContain("connect-src 'self';");
    }
  });
});
