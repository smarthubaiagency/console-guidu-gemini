/**
 * ============================================================================
 * File: e2e/auth-settings.spec.ts
 * Module: End-to-End Tests for Configurações › Autenticação (CF5b)
 *
 * Maintenance Rationale:
 * - The rig serves the app with `AUTH_GOOGLE_ENABLED=true` and without
 *   `AUTH_MAGIC_LINK_ENABLED`, so one run covers both halves of the rule: a
 *   button shows only with the provider on AND the cascade offering it.
 * - A platform owner reads the fixed rules (invitation only, e-mail
 *   verification, MFA in Segurança) and offers Google and the link: Google
 *   shows on the login page and leads to the provider with the host's
 *   callback; the link stays hidden (provider off).
 * - A partner owner hides Google on its own domain: its login page loses the
 *   button, the platform host keeps it.
 * - The saves are audited and listed in Segurança › Eventos.
 * - Everyone signs in before Google is offered (other helpers click
 *   "Entrar"), and the platform turns both methods off again at the end:
 *   other specs open /login.
 * ============================================================================
 */

import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  seedPartner,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { AUTH_BASE_URL, RIG } from "./support/rig";
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

/** The login page of a host, seen by a visitor without a session. */
async function visitLogin(
  browser: Browser,
  baseURL: string = RIG.appUrl,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  return { page, close: () => context.close() };
}

async function setMethod(
  page: Page,
  card: string,
  label: string,
  on: boolean,
): Promise<void> {
  const scope = page.getByTestId(card);
  await page.waitForLoadState("networkidle");
  const box = scope.getByLabel(label);
  if (on) await box.check();
  else await box.uncheck();
  await scope.getByRole("button", { name: "Salvar" }).click();
  await expect(statusBanner(page)).toContainText("Autenticação salva.");
}

test("the login page shows a method only with the provider on and the cascade offering it", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const host = `cf5b-${stamp}.localhost`;
  const partnerBase = `http://${host}:${RIG.appPort}`;

  // Sign everyone in while the login page has only the password.
  const owner = uniqueEmail("auth-owner");
  await createIdentity(request, owner);
  await makePlatformAdmin(request, owner);
  await signIn(page, owner);
  await enrolMfa(page);

  const partnerEmail = uniqueEmail("auth-partner");
  await createIdentity(request, partnerEmail);
  await seedPartner(request, {
    slug: `cf5b-${stamp}`,
    name: "Agência CF5b",
    host,
    memberEmail: partnerEmail,
    role: "partner_owner",
  });
  const partnerContext = await browser.newContext({ baseURL: partnerBase });
  const partnerPage = await partnerContext.newPage();
  await signIn(partnerPage, partnerEmail);
  await enrolMfa(partnerPage);

  // Off by default: no extra button.
  const before = await visitLogin(browser);
  await expect(before.page.getByTestId("login-google")).toHaveCount(0);
  await expect(before.page.getByTestId("login-magic-link")).toHaveCount(0);
  await before.close();

  await page.goto("/platform/settings");
  await page
    .getByTestId("settings-nav")
    .getByRole("link", { name: "Autenticação", exact: true })
    .click();
  await expect(page).toHaveURL(/\/platform\/settings\/authentication$/);
  await expect(page.getByTestId("auth-signup-mode")).toContainText(
    "Só por convite",
  );
  await expect(page.getByTestId("auth-email-verification")).toContainText(
    "Sempre ligada",
  );
  await expect(page.getByTestId("auth-mfa-link")).toHaveAttribute(
    "href",
    "/platform/settings/security",
  );
  await expect(page.getByTestId("auth-google-provider")).toHaveText(
    /Provedor no Supabase AuthLigado pela operação/,
  );
  await expect(page.getByTestId("auth-magic-link-provider")).toContainText(
    "Desligado",
  );
  await expect(page.getByTestId("auth-google-visible")).toContainText(
    "Escondido",
  );

  try {
    await setMethod(page, "auth-google", "Oferecer login com Google", true);
    await expect(page.getByTestId("auth-google-visible")).toContainText(
      "Aparece",
    );
    await setMethod(page, "auth-magic-link", "Oferecer link mágico", true);
    // Offered, but the provider is off: still hidden.
    await expect(page.getByTestId("auth-magic-link-visible")).toContainText(
      "Escondido",
    );

    // The platform host shows Google, and only Google.
    const offered = await visitLogin(browser);
    await expect(offered.page.getByTestId("login-google")).toBeVisible();
    await expect(offered.page.getByTestId("login-magic-link")).toHaveCount(0);

    // The button leads to the provider, coming back to this host.
    let authorize: URL | null = null;
    await offered.page.route(
      `${AUTH_BASE_URL}/auth/v1/authorize**`,
      (route) => {
        authorize = new URL(route.request().url());
        return route.fulfill({ status: 200, body: "provider" });
      },
    );
    await offered.page.getByTestId("login-google").click();
    await expect
      .poll(() => authorize?.searchParams.get("provider"))
      .toBe("google");
    const redirectTo = new URL(
      (authorize as URL | null)?.searchParams.get("redirect_to") ?? "",
    );
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/app");
    await offered.close();

    // The partner hides Google on its domain.
    await partnerPage.goto("/admin/settings/authentication");
    await expect(partnerPage.getByTestId("auth-google-offered")).toContainText(
      "Sim",
    );
    await expect(partnerPage.getByTestId("auth-google-visible")).toContainText(
      "Aparece",
    );
    await expect(partnerPage.getByTestId("auth-mfa-link")).toHaveAttribute(
      "href",
      "/admin/settings/security",
    );
    await setMethod(
      partnerPage,
      "auth-google",
      "Mostrar login com Google nos meus domínios",
      false,
    );
    await expect(partnerPage.getByTestId("auth-google-visible")).toContainText(
      "Escondido",
    );

    const onPartner = await visitLogin(browser, partnerBase);
    await expect(onPartner.page.getByTestId("login-google")).toHaveCount(0);
    await onPartner.close();
    const onPlatform = await visitLogin(browser);
    await expect(onPlatform.page.getByTestId("login-google")).toBeVisible();
    await onPlatform.close();
  } finally {
    await page.goto("/platform/settings/authentication");
    await setMethod(page, "auth-google", "Oferecer login com Google", false);
    await setMethod(page, "auth-magic-link", "Oferecer link mágico", false);
  }

  const after = await visitLogin(browser);
  await expect(after.page.getByTestId("login-google")).toHaveCount(0);
  await after.close();

  // Not offered by the platform: the partner's switch is locked.
  await partnerPage.goto("/admin/settings/authentication");
  await expect(partnerPage.getByTestId("auth-google-locked")).toBeVisible();
  await expect(partnerPage.getByTestId("auth-google-offered")).toContainText(
    "Não",
  );

  // The changes are security events too.
  await page.goto("/platform/settings/security/events");
  await expect(page.getByTestId("security-events-table")).toContainText(
    "Segurança da plataforma alterada",
  );
  await partnerPage.goto("/admin/settings/security/events");
  await expect(partnerPage.getByTestId("security-events-table")).toContainText(
    "Segurança do parceiro alterada",
  );
  await partnerContext.close();
});
