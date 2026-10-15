/**
 * ============================================================================
 * File: e2e/analytics.spec.ts
 * Module: End-to-End Tests for Configurações › Analytics (CF7)
 *
 * Maintenance Rationale:
 * - Off by default: the CSP keeps `connect-src 'self'` and nothing is sent.
 * - The platform turns Plausible on: the CSP opens only plausible.io (the
 *   nonce stays), and a page view carries only the area and the route,
 *   with no query string and no personal data. The provider is never
 *   reached: the browser's calls are answered by the test.
 * - The partner adds its own identifier: its login page sends to both
 *   sites; the partner's site never sees /platform.
 * - With PostHog nothing goes out before consent; after "Aceitar" the event
 *   carries an anonymous id and no person profile.
 * - Analytics is turned off again at the end (other specs need no banner).
 * ============================================================================
 */

import {
  expect,
  test,
  type Browser,
  type Page,
  type Request,
} from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  seedPartner,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

type Captured = { url: string; body: Record<string, unknown> };

/** Answers the provider's calls in the test and keeps their bodies. */
async function captureProvider(
  page: Page,
  pattern: string,
): Promise<Captured[]> {
  const captured: Captured[] = [];
  await page.route(pattern, async (route) => {
    const request: Request = route.request();
    captured.push({
      url: request.url(),
      body: JSON.parse(request.postData() ?? "{}") as Record<string, unknown>,
    });
    await route.fulfill({
      status: 202,
      headers: { "access-control-allow-origin": "*" },
      body: "ok",
    });
  });
  return captured;
}

async function savePlatform(
  page: Page,
  values: { enabled: boolean; provider?: string; siteId?: string },
): Promise<void> {
  await page.goto("/platform/settings/analytics");
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("analytics-platform");
  if (values.provider) {
    await card.getByLabel("Provedor").selectOption(values.provider);
  }
  if (values.siteId !== undefined) {
    await card.getByLabel("Identificador do site").fill(values.siteId);
  }
  const box = card.getByLabel("Ligar o analytics de produto");
  if (values.enabled) await box.check();
  else await box.uncheck();
  await card.getByRole("button", { name: "Salvar" }).click();
  await expect(statusBanner(page)).toContainText("Analytics salvo.");
}

async function visitor(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test("product analytics: off by default, provider in the CSP, no personal data", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const host = `cf7-${stamp}.localhost`;
  const partnerBase = `http://${host}:${RIG.appPort}`;

  const owner = uniqueEmail("analytics-owner");
  await createIdentity(request, owner);
  await makePlatformAdmin(request, owner);
  await signIn(page, owner);
  await enrolMfa(page);

  const partnerEmail = uniqueEmail("analytics-partner");
  await createIdentity(request, partnerEmail);
  await seedPartner(request, {
    slug: `cf7-${stamp}`,
    name: "Agência CF7",
    host,
    memberEmail: partnerEmail,
    role: "partner_owner",
  });
  const partnerContext = await browser.newContext({ baseURL: partnerBase });
  const partnerPage = await partnerContext.newPage();
  await signIn(partnerPage, partnerEmail);
  await enrolMfa(partnerPage);

  // Off by default.
  const before = await page.goto("/platform/settings");
  expect(before?.headers()["content-security-policy"]).toContain(
    "connect-src 'self';",
  );
  await page
    .getByTestId("settings-nav")
    .getByRole("link", { name: "Analytics", exact: true })
    .click();
  await expect(page).toHaveURL(/\/platform\/settings\/analytics$/);
  await expect(page.getByTestId("analytics-status")).toContainText("Desligado");
  await expect(page.getByTestId("analytics-consent")).toHaveCount(0);

  try {
    await savePlatform(page, {
      enabled: true,
      provider: "plausible",
      siteId: "painel.guidu.test",
    });
    await expect(page.getByTestId("analytics-csp")).toContainText(
      "https://plausible.io",
    );

    // A visitor of the platform: CSP opened for Plausible only, the nonce
    // kept, and a page view with the route alone.
    const platformVisitor = await visitor(browser, RIG.appUrl);
    const sent = await captureProvider(
      platformVisitor.page,
      "https://plausible.io/**",
    );
    const response = await platformVisitor.page.goto(
      "/login?next=/app&email=maria@exemplo.com",
    );
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("connect-src 'self' https://plausible.io;");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("posthog");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]!.body).toEqual({
      name: "pageview",
      url: `${RIG.appUrl}/login`,
      domain: "painel.guidu.test",
      props: { area: "auth" },
    });
    expect(JSON.stringify(sent)).not.toContain("maria");
    // Plausible keeps nothing: no consent banner.
    await expect(
      platformVisitor.page.getByTestId("analytics-consent"),
    ).toHaveCount(0);
    await platformVisitor.close();

    // The partner adds its own identifier.
    await partnerPage.goto("/admin/settings/analytics");
    await expect(
      partnerPage.getByTestId("analytics-platform-status"),
    ).toContainText("Ligado");
    await partnerPage.waitForLoadState("networkidle");
    const partnerCard = partnerPage.getByTestId("analytics-partner");
    await partnerCard
      .getByLabel("Identificador no Plausible")
      .fill("painel.agencia-cf7.test");
    await partnerCard.getByLabel("Ligar o meu identificador").check();
    await partnerCard.getByRole("button", { name: "Salvar" }).click();
    await expect(statusBanner(partnerPage)).toContainText("Analytics salvo.");
    await expect(
      partnerPage.getByTestId("analytics-partner-sending"),
    ).toContainText("Enviando");

    // The partner's login page sends to both sites.
    const partnerVisitor = await visitor(browser, partnerBase);
    const both = await captureProvider(
      partnerVisitor.page,
      "https://plausible.io/**",
    );
    await partnerVisitor.page.goto("/login");
    await expect.poll(() => both.length).toBe(2);
    expect(both.map((call) => call.body.domain).sort()).toEqual([
      "painel.agencia-cf7.test",
      "painel.guidu.test",
    ]);
    await partnerVisitor.close();

    // PostHog: nothing before consent.
    await savePlatform(page, {
      enabled: true,
      provider: "posthog",
      siteId: "phc_e2eCf7ProjectKey0123456789",
    });
    const consentVisitor = await visitor(browser, RIG.appUrl);
    const posthog = await captureProvider(
      consentVisitor.page,
      "https://us.i.posthog.com/**",
    );
    const posthogResponse = await consentVisitor.page.goto("/login");
    expect(posthogResponse?.headers()["content-security-policy"]).toContain(
      "connect-src 'self' https://us.i.posthog.com;",
    );
    const banner = consentVisitor.page.getByTestId("analytics-consent");
    await expect(banner).toBeVisible();
    await consentVisitor.page.waitForTimeout(500);
    expect(posthog).toHaveLength(0);
    await banner.getByRole("button", { name: "Aceitar" }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(() => posthog.length).toBe(1);
    expect(posthog[0]!.body).toMatchObject({
      api_key: "phc_e2eCf7ProjectKey0123456789",
      event: "$pageview",
      properties: {
        $current_url: `${RIG.appUrl}/login`,
        $process_person_profile: false,
        area: "auth",
      },
    });
    expect(typeof posthog[0]!.body.distinct_id).toBe("string");
    await consentVisitor.close();
  } finally {
    await savePlatform(page, {
      enabled: false,
      provider: "plausible",
      siteId: "",
    });
    await partnerContext.close();
  }

  const after = await page.goto("/platform/settings/analytics");
  expect(after?.headers()["content-security-policy"]).toContain(
    "connect-src 'self';",
  );
});
