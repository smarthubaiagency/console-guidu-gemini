/**
 * ============================================================================
 * File: e2e/plans-limits.spec.ts
 * Module: End-to-End Tests for Planos e limites (CF4)
 *
 * Maintenance Rationale:
 * - A platform owner creates a plan in Cobrança, sets the platform ceiling
 *   of `core.public_domains` in Configurações › Planos e limites, is refused
 *   a plan value above it and publishes the plan with 2 public domains (a
 *   new version, same prices).
 * - The partner sees the plan's limits read only in /admin › Configurações
 *   › Planos e limites, opens the customer's subscription on that plan and
 *   the workspace usage page shows the plan's limit.
 * - The ceiling is removed at the end: other specs share the database.
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
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";
import { RIG } from "./support/rig";

const DOMAINS = "Domínios públicos do workspace";

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

test("platform owner sets a plan's public domains and the workspace usage reflects it", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const planKey = `cf4-${stamp}`;
  const planName = `Plano CF4 ${stamp}`;

  // Platform owner with MFA.
  const ownerEmail = uniqueEmail("plans-owner");
  await createIdentity(request, ownerEmail);
  await makePlatformAdmin(request, ownerEmail);
  await signIn(page, ownerEmail);
  await enrolMfa(page);

  // A plan with its first version (prices) in Cobrança.
  await page.goto("/platform/billing");
  const create = page.getByTestId("create-plan");
  await create.getByLabel("Nome").fill(planName);
  await create.getByLabel("Chave (letras minúsculas e hífen)").fill(planKey);
  await create.getByRole("button", { name: "Criar plano" }).click();
  await expect(statusBanner(create)).toContainText("Plano criado");
  const planRow = page
    .getByTestId("platform-plans")
    .getByRole("listitem")
    .filter({ hasText: planName });
  await planRow.getByText("Publicar nova versão").click();
  const version = page.getByTestId(`publish-version-${planKey}`);
  await version.getByLabel("Piso (R$)").fill("100,00");
  await version.getByLabel("Repasse mínimo (R$)").fill("30,00");
  await version.getByLabel("Valor base do parceiro (R$)").fill("30,00");
  await version.getByRole("button", { name: "Publicar versão" }).click();
  await expect(statusBanner(version)).toContainText("Versão 1 publicada");

  // Configurações › Planos e limites: the ceiling, then the plan value.
  await page.goto("/platform/settings/plans");
  await expect(
    page
      .getByTestId("settings-nav")
      .getByRole("link", { name: "Planos e limites" }),
  ).toHaveAttribute("aria-current", "page");
  const catalog = page.getByTestId("plans-catalog");
  await expect(
    catalog
      .getByTestId("limits-row-core.storage_gb")
      .getByText("ainda não aplicado"),
  ).toBeVisible();

  const ceilings = page.getByTestId("quota-ceilings");
  await ceilings.getByRole("textbox", { name: `Teto: ${DOMAINS}` }).fill("5");
  await ceilings.getByRole("button", { name: "Salvar tetos" }).click();
  await expect(statusBanner(ceilings)).toContainText("Tetos salvos");

  const limits = page.getByTestId(`plan-limits-${planKey}`);
  const domainsInput = limits.getByRole("textbox", {
    name: new RegExp(`^${DOMAINS}`),
  });
  await domainsInput.fill("6");
  await limits.getByRole("button", { name: "Publicar nova versão" }).click();
  await expect(statusBanner(limits)).toContainText(
    "o valor passa do teto da plataforma (5)",
  );
  await domainsInput.fill("2");
  await limits.getByRole("button", { name: "Publicar nova versão" }).click();
  await expect(statusBanner(limits)).toContainText(
    "Limites publicados na versão 2 do plano.",
  );
  await page.reload();
  await expect(
    page
      .getByTestId("plans-catalog")
      .getByTestId("limits-row-core.public_domains")
      .getByTestId(`limits-plan-${planKey}`),
  ).toHaveText("2");

  // The partner sells the plan to its customer.
  const customerEmail = uniqueEmail("plans-customer");
  await createIdentity(request, customerEmail);
  const wsSlug = `plano-cf4-${stamp}`;
  const { organizationId } = await seedWorkspace(request, {
    email: customerEmail,
    orgName: `Cliente CF4 ${stamp}`,
    orgSlug: wsSlug,
    wsName: "Cliente CF4",
    wsSlug,
  });
  const partnerHost = `planos-${stamp}.localhost`;
  const partnerEmail = uniqueEmail("plans-partner");
  await createIdentity(request, partnerEmail);
  await seedPartner(request, {
    slug: `planos-${stamp}`,
    name: `Agência Planos ${stamp}`,
    host: partnerHost,
    memberEmail: partnerEmail,
    role: "partner_owner",
    organizationId,
  });

  const partnerContext = await browser.newContext({
    baseURL: `http://${partnerHost}:${RIG.appPort}`,
  });
  const partner = await partnerContext.newPage();
  await signIn(partner, partnerEmail);
  await enrolMfa(partner);

  // Read only: the limits of the plans the partner can sell.
  await partner.goto("/admin/settings/plans");
  const partnerCatalog = partner.getByTestId("partner-plans-catalog");
  await expect(
    partnerCatalog
      .getByTestId("limits-row-core.public_domains")
      .getByTestId(`limits-plan-${planKey}`),
  ).toHaveText("2");
  await expect(partnerCatalog.getByTestId("limits-ceiling")).toHaveCount(0);
  await expect(partner.getByTestId("quota-ceilings")).toHaveCount(0);

  await partner.goto("/admin/billing");
  const start = partner.getByTestId(`start-subscription-${organizationId}`);
  const option = start.locator("option", { hasText: planName });
  await start
    .getByRole("combobox")
    .selectOption((await option.getAttribute("value"))!);
  await start.getByRole("button", { name: "Abrir assinatura" }).click();
  await expect(
    partner
      .getByTestId("billing-customers")
      .getByRole("listitem")
      .filter({ hasText: `Cliente CF4 ${stamp}` })
      .getByTestId("subscription-status"),
  ).toHaveText("Aguardando pagamento");
  await partnerContext.close();

  // The customer, on the partner's host, sees the plan's limit.
  const customerContext = await browser.newContext({
    baseURL: `http://${partnerHost}:${RIG.appPort}`,
  });
  const customer = await customerContext.newPage();
  await signIn(customer, customerEmail);
  await customer.goto(`/app/${wsSlug}/settings/usage`);
  await expect(customer.getByTestId("usage-plan")).toContainText(planName);
  const domainsRow = customer.getByTestId("usage-core.public_domains");
  await expect(domainsRow.getByTestId("usage-value")).toHaveText("0 / 2");
  await expect(domainsRow).toContainText("limite do plano");
  await customerContext.close();

  // Remove the ceiling again: other specs read the same database.
  await page.goto("/platform/settings/plans");
  const restore = page.getByTestId("quota-ceilings");
  await restore.getByRole("textbox", { name: `Teto: ${DOMAINS}` }).fill("");
  await restore.getByRole("button", { name: "Salvar tetos" }).click();
  await expect(statusBanner(restore)).toContainText("Tetos salvos");
});
