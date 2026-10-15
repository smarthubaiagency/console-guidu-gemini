import { describe, expect, it } from "vitest";

import {
  analyticsArea,
  analyticsPath,
  analyticsRequest,
  isProductEvent,
} from "./privacy";

const UUID = "3f2b8c1e-9d4a-4e6b-8f1c-2a3b4c5d6e7f";

describe("analytics: no personal data (CF7)", () => {
  it("keeps only static route words", () => {
    expect(analyticsPath("/platform/settings/analytics")).toBe(
      "/platform/settings/analytics",
    );
    expect(analyticsPath(`/admin/customers/${UUID}`)).toBe(
      "/admin/customers/:id",
    );
    expect(analyticsPath(`/app/padaria-do-joao/crm/contacts/${UUID}`)).toBe(
      "/app/:workspace/crm/contacts/:id",
    );
    expect(analyticsPath("/app/account/security")).toBe(
      "/app/account/security",
    );
  });

  it("drops e-mails, tokens, numbers, codes, query strings and fragments", () => {
    expect(analyticsPath("/admin/members/maria@exemplo.com")).toBe(
      "/admin/members/:id",
    );
    expect(analyticsPath("/invite/AbCdEf_0123456789-xyz")).toBe("/invite/:id");
    expect(analyticsPath("/partner-invite/convite")).toBe(
      "/partner-invite/:id",
    );
    expect(analyticsPath("/platform/settings/languages/pt-BR")).toBe(
      "/platform/settings/languages/:id",
    );
    expect(analyticsPath("/app/loja/portfolio/12345")).toBe(
      "/app/:workspace/portfolio/:id",
    );
    expect(
      analyticsPath("/login?next=/app/x&email=maria@exemplo.com#token=abc"),
    ).toBe("/login");
    expect(analyticsPath("/")).toBe("/");
    const long = `/${"a".repeat(41)}`;
    expect(analyticsPath(long)).toBe("/:id");
  });

  it("names the area of the screen", () => {
    expect(analyticsArea("/platform/billing")).toBe("platform");
    expect(analyticsArea("/admin")).toBe("admin");
    expect(analyticsArea("/app/loja")).toBe("app");
    expect(analyticsArea("/login")).toBe("auth");
    expect(analyticsArea("/auth/mfa")).toBe("auth");
    expect(analyticsArea("/invite/abc")).toBe("auth");
    expect(analyticsArea("/legal/terms")).toBe("public");
    expect(analyticsArea("/applications")).toBe("public");
  });

  it("sends Plausible only the route, the area and the site", () => {
    const request = analyticsRequest({
      provider: "plausible",
      endpoint: "https://plausible.io/api/event",
      siteId: "painel.exemplo.com",
      origin: "https://painel.exemplo.com",
      pathname: `/app/padaria/crm/contacts/${UUID}?q=maria@exemplo.com`,
      event: "pageview",
      distinctId: null,
    });
    expect(request).not.toBeNull();
    expect(JSON.parse(request!.body)).toEqual({
      name: "pageview",
      url: "https://painel.exemplo.com/app/:workspace/crm/contacts/:id",
      domain: "painel.exemplo.com",
      props: { area: "app" },
    });
    expect(request!.body).not.toMatch(/maria|padaria|3f2b8c1e/);
  });

  it("sends PostHog nothing without the anonymous id kept after consent", () => {
    const input = {
      provider: "posthog" as const,
      endpoint: "https://us.i.posthog.com/i/v0/e/",
      siteId: "phc_abcdefghijklmnopqrstuvwxyz",
      origin: "https://painel.exemplo.com",
      pathname: "/admin/settings/analytics",
      event: "agent_created" as const,
    };
    expect(analyticsRequest({ ...input, distinctId: null })).toBeNull();
    const request = analyticsRequest({ ...input, distinctId: "anon-1" });
    const body = JSON.parse(request!.body) as Record<string, unknown>;
    expect(body.event).toBe("agent_created");
    expect(body.properties).toEqual({
      $current_url: "https://painel.exemplo.com/admin/settings/analytics",
      $pathname: "/admin/settings/analytics",
      $process_person_profile: false,
      area: "admin",
    });
  });

  it("knows only the planned product events", () => {
    expect(isProductEvent("login")).toBe(true);
    expect(isProductEvent("guids_activated")).toBe(true);
    expect(isProductEvent("email_sent")).toBe(false);
    expect(isProductEvent({ name: "login" })).toBe(false);
  });
});
