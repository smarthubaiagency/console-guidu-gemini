/**
 * ============================================================================
 * File: e2e/google-business.spec.ts
 * Module: GB1a — onboarding "Adicionar local" and the automation page
 *
 * Maintenance Rationale:
 * - The customer in `padrao` mode adds a location from the /app: the full
 *   screen window, the fake Google consent with a permission unchecked, the
 *   permissions screen, the choice of one ficha, the steps marked as they
 *   end, the unit created from the ficha and the automation page.
 * - On the automation page: "Aprovado, pode seguir" saves the area and goes
 *   to the next one; "Preciso saber mais" opens the specialist in the drawer.
 * - The partner registers a managed customer in /admin › Clientes and adds a
 *   location to it from there.
 * - Always the fake provider (`GOOGLE_BUSINESS_PROVIDER=fake`), never Zernio.
 * ============================================================================
 */

import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test,
} from "@playwright/test";

import {
  createIdentity,
  seedPartner,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

/** Fake Google consent: tick the permissions asked and allow. */
async function consent(page: Page, grantProfile: boolean) {
  await expect(
    page.getByRole("heading", { name: "Google (teste)" }),
  ).toBeVisible();
  const profile = page.getByLabel(/perfis da Empresa no Google/);
  if (grantProfile) await profile.check();
  else await profile.uncheck();
  await page.getByRole("button", { name: "Permitir" }).click();
}

async function connectAndChoose(page: Page, ficha: RegExp) {
  const window = page.getByTestId("add-location-window");
  await expect(window).toBeVisible();
  // Server-rendered after each redirect: click only once hydrated.
  await page.waitForLoadState("networkidle");
  await window.getByRole("button", { name: "Entrar com Google" }).click();
  // First time: the permission to manage the ficha is left unchecked.
  await consent(page, false);
  const missing = page.getByTestId("missing-permissions");
  await expect(missing).toContainText("Faltaram permissões do Google");
  await expect(missing).toContainText(
    "O agente não apaga a ficha e não altera nada sem a sua permissão.",
  );
  await page.waitForLoadState("networkidle");
  await missing
    .getByRole("button", { name: "Voltar às permissões do Google" })
    .click();
  await consent(page, true);
  await expect(page.getByText("Escolha a ficha")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByLabel(ficha).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  const steps = page.getByTestId("onboarding-steps");
  await expect(steps.getByRole("listitem")).toHaveCount(7);
  await expect(page.getByTestId("onboarding-ready")).toBeVisible({
    timeout: 30_000,
  });
  await expect(steps.locator('[data-state="done"]')).toHaveCount(7);
}

test("the customer adds a location and reviews the automation page", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("gb-owner");
  const wsSlug = `gb-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Padaria ${stamp}`,
    orgSlug: `org-gb-${stamp}`,
    wsName: "Padaria",
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page
    .getByRole("button", { name: "Habilitar Google Meu Negócio" })
    .click();
  await expect(statusBanner(page)).toBeVisible();

  await page.goto(`/app/${wsSlug}/google-business`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Adicionar local" }).first().click();
  await connectAndChoose(page, /Padaria Pão Dourado — Centro/);

  const ready = page.getByTestId("onboarding-ready");
  await expect(ready).toContainText(/Encontramos \d+ pontos para validar/);
  await ready
    .getByRole("button", { name: "Abrir a página de automação" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/app/${wsSlug}/google-business/locations/[0-9a-f-]{36}`),
  );
  await expect(page.getByTestId("add-location-window")).toHaveCount(0);

  // The unit was created from the ficha.
  await expect(
    page.getByRole("heading", { name: "Padaria Pão Dourado — Centro" }),
  ).toBeVisible();
  await expect(
    page.getByText("Rua das Flores, 120, São Paulo").first(),
  ).toBeVisible();
  const progress = page.getByTestId("automation-progress");
  await expect(progress).toContainText("0 de 6 áreas configuradas");
  await expect(progress).toContainText(/\d+ de \d+ itens em ordem/);
  await expect(
    page.getByText("Só sugere até a primeira revisão"),
  ).toBeVisible();

  // Reviews area: tips from the analyses, then approve and go on.
  const detail = page.getByTestId("area-detail");
  const areaTitle = detail.locator('[data-slot="card-title"]');
  await expect(areaTitle).toHaveText("Avaliações");
  await expect(detail.getByTestId("area-tips")).toContainText(
    "Avaliações sem resposta",
  );
  await detail.getByLabel(/Confiar no agente \(automático\)/).check();
  await detail.getByRole("button", { name: "Aprovado, pode seguir" }).click();
  await expect(statusBanner(page)).toContainText("Avaliações aprovada!");
  await expect(areaTitle).toHaveText("Defesa da ficha");
  await expect(progress).toContainText("1 de 6 áreas configuradas");

  // The forbidden promises are nowhere on the page.
  const body = (await page.locator("main").textContent()) ?? "";
  for (const forbidden of [
    /1\.000 pontos/,
    /reverte em segundos/i,
    /geotagging/i,
    /otimiza/i,
  ]) {
    expect(body).not.toMatch(forbidden);
  }

  // "Preciso saber mais": the specialist answers in the drawer.
  await detail.getByRole("button", { name: "Preciso saber mais" }).click();
  const drawer = page.getByRole("complementary", { name: "Agente do Google" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Sua pergunta").fill("O que faz a defesa da ficha?");
  await drawer.getByRole("button", { name: "Enviar" }).click();
  await expect(drawer.getByTestId("specialist-messages")).toContainText(
    "Resposta de teste do agente: O que faz a defesa da ficha?",
  );

  // The unit is in Configurações › Lojas, and the ficha in the module list.
  await page.goto(`/app/${wsSlug}/settings/locations`);
  await expect(
    page.getByText("Padaria Pão Dourado — Centro").first(),
  ).toBeVisible();
  await page.goto(`/app/${wsSlug}/google-business`);
  await expect(page.getByTestId("gb-locations")).toContainText(
    "1 de 6 áreas configuradas",
  );
});

async function partnerOwner(
  browser: Browser,
  request: APIRequestContext,
  stamp: string,
): Promise<{ page: Page; host: string }> {
  const host = `gb-parceiro-${stamp}.localhost`;
  const email = uniqueEmail("gb-partner");
  await createIdentity(request, email);
  await seedPartner(request, {
    slug: `gb-parceiro-${stamp}`,
    name: `Agência GB ${stamp}`,
    host,
    memberEmail: email,
    role: "partner_owner",
  });
  const context = await browser.newContext({
    baseURL: `http://${host}:${RIG.appPort}`,
    locale: "pt-BR",
  });
  const page = await context.newPage();
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
  return { page, host };
}

test("the partner registers a managed customer and adds a location from /admin", async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const { page } = await partnerOwner(browser, request, stamp);

  await page.goto("/admin/customers");
  const form = page.getByTestId("create-customer");
  await form.getByLabel("Empresa").fill(`Cliente GB ${stamp}`);
  await form
    .getByLabel("E-mail do responsável")
    .fill(uniqueEmail("gb-cliente"));
  await form.getByLabel("Nome do workspace").fill("Loja do Cliente");
  await form.getByLabel("Endereço do workspace").fill(`cliente-gb-${stamp}`);
  await expect(form.getByLabel("Modo de serviço")).toHaveValue("gerenciado");
  await form.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(statusBanner(page)).toBeVisible();
  await page.reload();

  const customers = page.getByTestId("partner-customers");
  await expect(customers).toContainText(`Cliente GB ${stamp}`);
  await expect(customers).toContainText("Gerenciado");
  const managed = customers.getByTestId("managed-workspaces");
  await expect(managed).toContainText("Loja do Cliente");
  await managed.getByRole("link", { name: "Adicionar local" }).click();
  await connectAndChoose(page, /Padaria Pão Dourado — Campinas/);
  await page
    .getByTestId("onboarding-ready")
    .getByRole("button", { name: "Abrir a página de automação" })
    .click();
  await expect(page).toHaveURL(
    /\/admin\/customers\/workspaces\/[0-9a-f-]{36}\/locations\/[0-9a-f-]{36}/,
  );
  await expect(
    page.getByRole("heading", { name: "Padaria Pão Dourado — Campinas" }),
  ).toBeVisible();
  const detail = page.getByTestId("area-detail");
  await detail.getByRole("button", { name: "Aprovado, pode seguir" }).click();
  await expect(statusBanner(page)).toContainText("Avaliações aprovada!");
  await expect(page.getByTestId("automation-progress")).toContainText(
    "1 de 6 áreas configuradas",
  );
  await page.context().close();
});
