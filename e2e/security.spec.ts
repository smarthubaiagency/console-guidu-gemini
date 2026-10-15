/**
 * ============================================================================
 * File: e2e/security.spec.ts
 * Module: End-to-End Tests for Configurações › Segurança (CF5a)
 *
 * Maintenance Rationale:
 * - A platform owner sees MFA always required in /platform and /admin,
 *   cannot save an IP list that leaves out their own address, saves one
 *   that includes it, turns it off again and reads the security events.
 * - A partner owner saves an IP list for its /admin; from an address
 *   outside it the console answers with the IP denial, from inside it the
 *   console opens. No proxy runs in the rig, so the browser's
 *   X-Forwarded-For plays Traefik's (TRUSTED_PROXY_HOPS=1).
 * - A workspace owner can only require MFA of the team after enabling it;
 *   a member without a factor is then sent to enable it.
 * - Every list is removed at the end: other specs open /platform.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  seedPartner,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

/** Fills the list once the page is hydrated (the form resets on render). */
async function fillList(page: Page, text: string): Promise<void> {
  const field = page
    .getByTestId("security-ip")
    .getByLabel(/Endereços liberados/);
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await field.fill(text);
    await expect(field).toHaveValue(text, { timeout: 500 });
  }).toPass();
}

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

test("a platform owner manages MFA and the /platform IP list", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("security-owner");
  await createIdentity(page.request, email);
  await makePlatformAdmin(page.request, email);
  await signIn(page, email);
  await enrolMfa(page);

  await page.goto("/platform/settings");
  await page
    .getByTestId("settings-nav")
    .getByRole("link", { name: "Segurança", exact: true })
    .click();
  await expect(page).toHaveURL(/\/platform\/settings\/security$/);
  await expect(page.getByTestId("mfa-area-platform")).toContainText(
    "Sempre exigida",
  );
  await expect(page.getByTestId("mfa-area-admin")).toContainText(
    "Sempre exigida",
  );
  await expect(page.getByTestId("mfa-area-app")).toContainText("Opcional");
  await expect(page.getByTestId("security-password")).toContainText(
    "Supabase Auth",
  );

  const ip = page.getByTestId("security-ip");
  const current = (
    await page.getByTestId("ip-current").locator("dd").textContent()
  )?.trim();
  expect(current).toMatch(/^[0-9a-f.:]+$/);

  try {
    // A list without the saver's address is refused.
    await fillList(page, "192.0.2.0/24");
    await ip.getByRole("button", { name: "Salvar lista" }).click();
    await expect(statusBanner(page)).toContainText(
      "A lista precisa incluir o seu endereço atual",
    );
    await fillList(page, "192.0.2.0/24 nope");
    await ip.getByRole("button", { name: "Salvar lista" }).click();
    await expect(statusBanner(page)).toContainText("Endereço inválido");

    await fillList(page, `192.0.2.0/24\n${current}`);
    await ip.getByRole("button", { name: "Salvar lista" }).click();
    await expect(statusBanner(page)).toContainText("Lista de IPs salva.");
    await expect(page.getByTestId("ip-state").locator("dd")).toHaveText(
      "Ligada (2 endereços)",
    );
    // The saver still enters /platform.
    await page.goto("/platform/settings/security");
    await expect(page.getByTestId("security-ip")).toBeVisible();
  } finally {
    await page.goto("/platform/settings/security");
    await fillList(page, "");
    await ip.getByRole("button", { name: "Salvar lista" }).click();
    await expect(statusBanner(page)).toContainText("Lista de IPs salva.");
  }
  await expect(page.getByTestId("ip-state").locator("dd")).toHaveText(
    "Desligada: qualquer endereço entra",
  );

  await page
    .getByTestId("settings-nav")
    .getByRole("link", { name: "Eventos de segurança" })
    .click();
  const events = page.getByTestId("security-events-table");
  await expect(events).toContainText("Lista de IPs da plataforma alterada");
  await expect(events).toContainText("Login");
  await expect(events).toContainText("(você)");
});

test("a partner's IP list keeps other addresses out of its /admin", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const host = `cf5-${stamp}.localhost`;
  const email = uniqueEmail("security-partner");
  await createIdentity(request, email);
  await seedPartner(request, {
    slug: `cf5-${stamp}`,
    name: "Agência CF5",
    host,
    memberEmail: email,
    role: "partner_owner",
  });

  const context = await browser.newContext({
    baseURL: `http://${host}:${RIG.appPort}`,
    extraHTTPHeaders: { "x-forwarded-for": "203.0.113.7" },
  });
  const page = await context.newPage();
  await signIn(page, email);
  await enrolMfa(page);

  await page.goto("/admin/settings/security");
  await expect(page.getByTestId("ip-current").locator("dd")).toHaveText(
    "203.0.113.7",
  );
  const ip = page.getByTestId("security-ip");
  await fillList(page, "203.0.113.0/24");
  await ip.getByRole("button", { name: "Salvar lista" }).click();
  await expect(statusBanner(page)).toContainText("Lista de IPs salva.");

  // From another address the console refuses, with the reason.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.9" });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/auth\/denied\?reason=ip$/);
  await expect(page.getByTestId("denied-ip")).toBeVisible();

  // Back inside the list, the console opens and the list goes away.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.20" });
  await page.goto("/admin/settings/security");
  await fillList(page, "");
  await ip.getByRole("button", { name: "Salvar lista" }).click();
  await expect(statusBanner(page)).toContainText("Lista de IPs salva.");

  await page.goto("/admin/settings/security/events");
  await expect(page.getByTestId("security-events-table")).toContainText(
    "Lista de IPs do parceiro alterada",
  );
  await context.close();
});

test("a workspace owner requires MFA of the team", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const wsSlug = `ws-cf5-${stamp}`;
  const workspace = {
    orgName: `Empresa CF5 ${stamp}`,
    orgSlug: `org-cf5-${stamp}`,
    wsName: "Workspace CF5",
    wsSlug,
  };
  const owner = uniqueEmail("security-ws-owner");
  const member = uniqueEmail("security-ws-member");
  await createIdentity(request, owner);
  await createIdentity(request, member);
  await seedWorkspace(request, { email: owner, ...workspace, role: "owner" });
  await seedWorkspace(request, { email: member, ...workspace, role: "viewer" });

  await signIn(page, owner);
  await page.goto(`/app/${wsSlug}/settings/security`);
  const card = page.getByTestId("security-mfa");
  await expect(page.getByTestId("mfa-area-app")).toContainText("Opcional");
  await expect(page.getByTestId("mfa-saver-missing")).toBeVisible();

  // Without the second factor, the owner cannot require it.
  await card
    .getByLabel("Exigir MFA de todos os membros deste workspace")
    .check();
  await card.getByRole("button", { name: "Salvar MFA" }).click();
  await expect(statusBanner(page)).toContainText("antes de exigi-la da equipe");

  await enrolMfa(page);
  await page.goto(`/app/${wsSlug}/settings/security`);
  await card
    .getByLabel("Exigir MFA de todos os membros deste workspace")
    .check();
  await card.getByRole("button", { name: "Salvar MFA" }).click();
  await expect(statusBanner(page)).toContainText(
    "Configurações de segurança salvas.",
  );
  await expect(page.getByTestId("mfa-area-app")).toContainText("Exigida");

  // A member without a factor is sent to enable it, outside the workspace.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, member);
  await memberPage.goto(`/app/${wsSlug}`);
  await expect(memberPage).toHaveURL(
    /\/app\/account\/security\?reason=mfa-required/,
  );
  await expect(memberPage.getByTestId("mfa-required-state")).toBeVisible();
  await enrolMfa(memberPage);
  await memberPage.goto(`/app/${wsSlug}/settings/security`);
  await expect(memberPage.getByTestId("mfa-area-app")).toContainText("Exigida");
  await memberContext.close();
});
