/**
 * ============================================================================
 * File: e2e/api-integrations.spec.ts
 * Module: End-to-End Tests for API e Integrações (CF6b)
 *
 * Maintenance Rationale:
 * - A platform owner turns the REST API off in Configurações › API e MCP:
 *   a workspace key gets 503 in English; on again, the key works and its
 *   calls and errors show per key in the /app and on the platform page.
 *   The scopes of a plan are saved and put back as they were.
 * - The platform registers the GUIDU's Google app (the secret comes back
 *   only masked); a workspace owner connects and disconnects the Google
 *   account through the fake provider of the rig
 *   (`GOOGLE_OAUTH_PROVIDER=fake`).
 * - A partner narrows the Google scopes and registers its own app on its
 *   host; its customer connects from the partner host, through the fixed
 *   callback of APP_URL, and comes back to the partner host.
 * - The API ends turned on and the platform's Google app stays (other
 *   specs never use it).
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

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

async function issueKey(page: Page, wsSlug: string, name: string) {
  await page.goto(`/app/${wsSlug}/settings/mcp`);
  await page.getByRole("button", { name: "Emitir Nova Chave" }).click();
  await page.getByPlaceholder("Ex: Conector Cursor / Claude Code").fill(name);
  await page.getByRole("button", { name: "Emitir Chave" }).click();
  const shown = page.getByText(/gdu_live_[0-9a-f]{64}/);
  await expect(shown).toBeVisible();
  const raw = (await shown.textContent())?.match(/gdu_live_[0-9a-f]{64}/)?.[0];
  expect(raw).toBeTruthy();
  return raw!;
}

async function saveSwitch(page: Page, on: boolean): Promise<void> {
  await page.goto("/platform/settings/api");
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("api-switches");
  const box = card.getByTestId("api-switch-rest");
  if (on) await box.check();
  else await box.uncheck();
  await card.getByRole("button", { name: "Salvar" }).click();
  await expect(statusBanner(page)).toContainText(
    "Configurações da API salvas.",
  );
}

test("the platform turns the API off and on; usage per key shows in /app and /platform", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const owner = uniqueEmail("cf6b-platform");
  await createIdentity(request, owner);
  await makePlatformAdmin(request, owner);
  await signIn(page, owner);
  await enrolMfa(page);

  const customer = uniqueEmail("cf6b-customer");
  const wsSlug = `cf6b-api-${stamp}`;
  await createIdentity(request, customer);
  const { workspaceId } = await seedWorkspace(request, {
    email: customer,
    orgName: `CF6b API ${stamp}`,
    orgSlug: `cf6b-api-org-${stamp}`,
    wsName: `Workspace CF6b ${stamp}`,
    wsSlug,
    role: "owner",
  });
  const customerContext = await browser.newContext({ baseURL: RIG.appUrl });
  const customerPage = await customerContext.newPage();
  await signIn(customerPage, customer);
  const key = await issueKey(customerPage, wsSlug, "Chave CF6b");
  const headers = { authorization: `Bearer ${key}` };

  // The settings menu leads to API e MCP.
  await page.goto("/platform/settings");
  await page
    .getByTestId("settings-nav")
    .getByRole("link", { name: "API e MCP", exact: true })
    .click();
  await expect(page).toHaveURL(/\/platform\/settings\/api$/);
  await expect(page.getByTestId("api-limit-key")).toContainText("60");
  await expect(page.getByTestId("api-limit-workspace")).toContainText("300");

  try {
    await saveSwitch(page, false);
    await expect(async () => {
      const off = await request.get(`/api/v1/workspaces/${workspaceId}`, {
        headers,
      });
      expect(off.status()).toBe(503);
      expect((await off.json()).error).toMatchObject({
        code: "service_disabled",
        message: "The GUIDU API is turned off. Try again later.",
      });
    }).toPass({ timeout: 15_000 });
  } finally {
    await saveSwitch(page, true);
  }

  await expect(async () => {
    const on = await request.get(`/api/v1/workspaces/${workspaceId}`, {
      headers,
    });
    expect(on.status()).toBe(200);
  }).toPass({ timeout: 15_000 });
  // A route outside the key's scopes counts as an error.
  const denied = await request.get(
    `/api/v1/workspaces/${workspaceId}/members`,
    {
      headers,
    },
  );
  expect(denied.status()).toBe(403);

  // Usage per key in /app › API e Webhooks.
  await customerPage.goto(`/app/${wsSlug}/settings/api`);
  const mine = customerPage.getByTestId("api-key-usage");
  await expect(mine.getByText("Chave CF6b")).toBeVisible();
  await expect(mine.getByTestId("key-usage-calls").first()).toHaveText("2");
  await expect(mine.getByTestId("key-usage-errors").first()).toHaveText("1");
  await expect(customerPage.getByTestId("api-settings")).toContainText(
    "Limites por minuto do seu plano: 60 por chave",
  );

  // And on the platform, with where the key lives.
  await page.goto("/platform/settings/api");
  const usage = page.getByTestId("api-key-usage");
  await expect(usage.getByText("Chave CF6b")).toBeVisible();
  await expect(usage).toContainText(`Workspace CF6b ${stamp}`);

  // Scopes of a plan: save a narrower list, then put every scope back.
  const plans = page.getByTestId("api-plan-scopes");
  const fieldsets = plans.locator("fieldset");
  if ((await fieldsets.count()) > 0) {
    const first = fieldsets.first();
    const box = first.getByRole("checkbox").last();
    await page.waitForLoadState("networkidle");
    await box.uncheck();
    await plans.getByRole("button", { name: "Salvar" }).click();
    await expect(statusBanner(page)).toContainText(
      "Configurações da API salvas.",
    );
    await expect(first).toContainText("(lista própria)");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .getByTestId("api-plan-scopes")
      .locator("fieldset")
      .first()
      .getByRole("checkbox")
      .last()
      .check();
    await page
      .getByTestId("api-plan-scopes")
      .getByRole("button", { name: "Salvar" })
      .click();
    await expect(statusBanner(page)).toContainText(
      "Configurações da API salvas.",
    );
    await expect(
      page.getByTestId("api-plan-scopes").locator("fieldset").first(),
    ).toContainText("(todos)");
  }
  await customerContext.close();
});

test("the workspace connects its Google account through the platform's or the partner's app", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const owner = uniqueEmail("cf6b-google-platform");
  await createIdentity(request, owner);
  await makePlatformAdmin(request, owner);
  await signIn(page, owner);
  await enrolMfa(page);

  // The platform registers the GUIDU's app.
  await page.goto("/platform/settings/integrations/google");
  await expect(page.getByTestId("google-redirect-uri")).toContainText(
    "/api/integrations/google/callback",
  );
  await page.waitForLoadState("networkidle");
  const appCard = page.getByTestId("google-app");
  await appCard
    .getByLabel("Client ID")
    .fill("guidu-e2e.apps.googleusercontent.com");
  await appCard.getByLabel("Client Secret").fill("GOCSPX-segredo-e2e-123456");
  await appCard.getByLabel("Verificação do Google").selectOption("verified");
  await appCard.getByRole("button", { name: "Salvar app" }).click();
  await expect(statusBanner(page)).toContainText("App do Google salvo.");
  await expect(page.getByTestId("google-secret-masked")).toContainText("...");
  await expect(page.locator("body")).not.toContainText(
    "GOCSPX-segredo-e2e-123456",
  );
  await expect(page.getByTestId("google-verification")).toContainText(
    "Verificado",
  );

  // A workspace owner connects and disconnects (fake Google).
  const customer = uniqueEmail("cf6b-google-owner");
  const wsSlug = `cf6b-google-${stamp}`;
  await createIdentity(request, customer);
  await seedWorkspace(request, {
    email: customer,
    orgName: `CF6b Google ${stamp}`,
    orgSlug: `cf6b-google-org-${stamp}`,
    wsName: `Workspace Google ${stamp}`,
    wsSlug,
    role: "owner",
  });
  const customerContext = await browser.newContext({ baseURL: RIG.appUrl });
  const customerPage = await customerContext.newPage();
  await signIn(customerPage, customer);
  await customerPage.goto(`/app/${wsSlug}/settings`);
  await customerPage.waitForURL(/\/settings\/general$/);
  await customerPage.waitForLoadState("networkidle");
  await customerPage
    .getByTestId("settings-nav")
    .getByRole("link", { name: "Integrações", exact: true })
    .click();
  await expect(customerPage).toHaveURL(/\/settings\/integrations$/);
  await expect(customerPage.getByTestId("google-account")).toContainText(
    "Nenhuma",
  );
  await expect(customerPage.getByTestId("google-app-source")).toContainText(
    "App da GUIDU",
  );
  await customerPage.waitForLoadState("networkidle");
  await customerPage.getByTestId("google-connect").click();
  await customerPage.waitForURL(/google=connected/);
  await expect(statusBanner(customerPage)).toContainText(
    "Conta Google conectada.",
  );
  await expect(customerPage.getByTestId("google-account")).toContainText(
    "conta.google@example.com",
  );
  await expect(customerPage.getByTestId("google-scopes-list")).toContainText(
    "Planilhas",
  );
  await customerPage
    .getByTestId("google-disconnect")
    .getByRole("button", { name: "Desconectar" })
    .click();
  await expect(statusBanner(customerPage)).toContainText(
    "Conta Google desconectada.",
  );
  await expect(customerPage.getByTestId("google-account")).toContainText(
    "Nenhuma",
  );

  // A partner narrows the scopes and registers its own app on its host.
  const host = `cf6b-${stamp}.localhost`;
  const partnerBase = `http://${host}:${RIG.appPort}`;
  const partnerEmail = uniqueEmail("cf6b-partner");
  await createIdentity(request, partnerEmail);
  const partnerCustomer = uniqueEmail("cf6b-partner-customer");
  const partnerSlug = `cf6b-pc-${stamp}`;
  await createIdentity(request, partnerCustomer);
  const { organizationId } = await seedWorkspace(request, {
    email: partnerCustomer,
    orgName: `CF6b Cliente ${stamp}`,
    orgSlug: `cf6b-pc-org-${stamp}`,
    wsName: `Cliente Parceiro ${stamp}`,
    wsSlug: partnerSlug,
    role: "owner",
  });
  await seedPartner(request, {
    slug: `cf6b-${stamp}`,
    name: "Agência CF6b",
    host,
    memberEmail: partnerEmail,
    role: "partner_owner",
    organizationId,
  });
  const partnerContext = await browser.newContext({ baseURL: partnerBase });
  const partnerPage = await partnerContext.newPage();
  await signIn(partnerPage, partnerEmail);
  await enrolMfa(partnerPage);
  await partnerPage.goto("/admin/settings");
  await partnerPage
    .getByTestId("settings-nav")
    .getByRole("link", { name: "Google", exact: true })
    .click();
  await expect(partnerPage).toHaveURL(/\/admin\/settings\/integrations$/);
  await expect(partnerPage.getByTestId("google-app-state")).toContainText(
    "Usando o app da GUIDU",
  );
  await partnerPage.waitForLoadState("networkidle");
  await partnerPage.getByTestId("google-scope-calendar.events").click();
  await partnerPage
    .getByTestId("google-scopes")
    .getByRole("button", { name: "Salvar escopos" })
    .click();
  await expect(statusBanner(partnerPage)).toContainText("Escopos salvos.");
  const partnerApp = partnerPage.getByTestId("google-app");
  await partnerApp
    .getByLabel("Client ID")
    .fill("agencia-e2e.apps.googleusercontent.com");
  await partnerApp.getByLabel("Client Secret").fill("GOCSPX-agencia-e2e-98765");
  await partnerApp.getByRole("button", { name: "Salvar app" }).click();
  await expect(statusBanner(partnerPage)).toContainText("App do Google salvo.");

  // The partner's customer connects from the partner host and comes back to it.
  const pcContext = await browser.newContext({ baseURL: partnerBase });
  const pcPage = await pcContext.newPage();
  await signIn(pcPage, partnerCustomer);
  await pcPage.goto(`/app/${partnerSlug}/settings/integrations`);
  await expect(pcPage.getByTestId("google-app-source")).toContainText(
    "App do parceiro",
  );
  const offered = pcPage.getByTestId("google-scopes-list");
  await expect(offered).toContainText("Planilhas");
  await expect(offered).not.toContainText("Agenda");
  await pcPage.waitForLoadState("networkidle");
  await pcPage.getByTestId("google-connect").click();
  await pcPage.waitForURL(
    (url) =>
      url.host === `${host}:${RIG.appPort}` &&
      /google=connected/.test(url.search),
  );
  await expect(pcPage.getByTestId("google-account")).toContainText(
    "conta.google@example.com",
  );
  await expect(pcPage.getByTestId("google-scopes-list")).not.toContainText(
    "Agenda",
  );

  // The partner removes its app: its customers go back to the GUIDU's.
  await partnerPage.reload();
  await partnerPage.waitForLoadState("networkidle");
  await partnerPage
    .getByTestId("google-app-remove")
    .getByRole("button", { name: "Remover app próprio" })
    .click();
  await expect(statusBanner(partnerPage)).toContainText(
    "App próprio removido.",
  );
  await expect(partnerPage.getByTestId("google-app-state")).toContainText(
    "Usando o app da GUIDU",
  );
  await pcPage.reload();
  await expect(pcPage.getByTestId("google-app-source")).toContainText(
    "App da GUIDU",
  );

  await pcContext.close();
  await partnerContext.close();
  await customerContext.close();
});
