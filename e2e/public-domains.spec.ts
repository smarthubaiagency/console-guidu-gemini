/**
 * ============================================================================
 * File: e2e/public-domains.spec.ts
 * Module: End-to-End Tests for the default public domains (CF2c)
 *
 * Maintenance Rationale:
 * - A partner owner sees the platform default domain of each public route
 *   type in /admin › Configurações › Domínios, adds its own default domain
 *   for the digital profile, sees the two CNAME instructions (domain and
 *   wildcard), verifies (the DNS does not point, so it stays pending) and
 *   removes it.
 * - The customer's workspace shows its default address of each type in
 *   /app › Configurações › Domínios, outside the plan's domain quota.
 * - The ForwardAuth serves a workspace's default host and refuses unknown
 *   and reserved names.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedPartner,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";
import { RIG } from "./support/rig";

const CHECK_SECRET = "e2e-domains-check-secret";

test("a partner manages its customers' default domains and the workspace sees its addresses", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const wsSlug = `loja-pub-${stamp}`;

  const customerEmail = uniqueEmail("publico-cliente");
  await createIdentity(request, customerEmail);
  const workspace = await seedWorkspace(request, {
    email: customerEmail,
    orgName: `Loja ${stamp}`,
    orgSlug: wsSlug,
    wsName: "Loja",
    wsSlug,
  });

  const partnerHost = `publico-${stamp}.localhost`;
  const ownerEmail = uniqueEmail("publico-parceiro");
  await createIdentity(request, ownerEmail);
  await seedPartner(request, {
    slug: `publico-${stamp}`,
    name: `Agência ${stamp}`,
    host: partnerHost,
    memberEmail: ownerEmail,
    role: "partner_owner",
    organizationId: workspace.organizationId,
  });

  const context = await browser.newContext({
    baseURL: `http://${partnerHost}:${RIG.appPort}`,
  });
  const admin = await context.newPage();
  await signIn(admin, ownerEmail);
  await admin.goto("/app/account/security");
  await admin.getByTestId("start-mfa-enrolment").click();
  const secret = (await admin.getByTestId("totp-secret").textContent())?.trim();
  await admin.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await admin.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(admin.getByTestId("mfa-factors")).toBeVisible();

  await admin.goto("/admin/settings/domains");
  const bases = admin.getByTestId("partner-public-domains");
  await expect(bases.locator('[data-route-type="profile"]')).toContainText(
    "Padrão da plataforma: mobio.pro",
  );
  await expect(bases.locator('[data-route-type="quiz"]')).toContainText(
    "Padrão da plataforma: quiz.mobio.pro",
  );
  await expect(bases.locator('[data-route-type="page"]')).toContainText(
    "Padrão da plataforma: mobio.page",
  );

  const base = `cartao-${stamp}.test`;
  await admin.waitForLoadState("networkidle");
  await bases.getByLabel("Tipo").selectOption("profile");
  await bases.getByLabel("Domínio").fill(base);
  await bases.getByRole("button", { name: "Adicionar domínio" }).click();
  await expect(statusBanner(admin)).toContainText(
    `Domínio ${base} adicionado. Crie os registros CNAME`,
  );
  const row = bases.locator(`[data-host="${base}"]`);
  await expect(row.getByTestId("public-base-status")).toHaveText("Pendente");
  await expect(row.getByTestId("public-base-instructions")).toContainText(
    `*.${base}`,
  );
  await expect(row.getByTestId("public-base-instructions")).toContainText(
    "proxy.guidu.test",
  );

  await row.getByRole("button", { name: "Verificar" }).click();
  await expect(statusBanner(admin)).toContainText(
    "O CNAME ainda não aponta para o destino",
  );
  await expect(row.getByTestId("public-base-status")).toHaveText("Pendente");
  await expect(row.getByTestId("public-base-last-check")).toBeVisible();

  await row.getByTestId("domain-remove").click();
  const question = statusBanner(admin);
  await expect(question).toHaveAttribute("role", "alertdialog");
  await expect(question).toContainText(`Remover o domínio ${base}?`);
  await question.getByTestId("smart-status-action").click();
  await expect(statusBanner(admin)).toContainText(`Domínio ${base} removido`);
  await expect(row).toHaveCount(0);
  await context.close();

  // The customer's workspace shows its default addresses (a partner's
  // customer only opens on the partner's host).
  const customerContext = await browser.newContext({
    baseURL: `http://${partnerHost}:${RIG.appPort}`,
  });
  const page = await customerContext.newPage();
  await signIn(page, customerEmail);
  await page.goto(`/app/${wsSlug}/settings/domains`);
  const addresses = page.getByTestId("public-addresses");
  await expect(addresses.locator('[data-route-type="profile"]')).toContainText(
    `${wsSlug}.mobio.pro`,
  );
  await expect(addresses.locator('[data-route-type="quiz"]')).toContainText(
    `${wsSlug}.quiz.mobio.pro`,
  );
  await expect(addresses.locator('[data-route-type="page"]')).toContainText(
    `${wsSlug}.mobio.page`,
  );
  // Outside the quota: the plan still has no own domain.
  await expect(page.getByTestId("domain-quota")).toHaveText(
    "O plano atual não inclui domínio próprio. Fale com quem administra a sua conta.",
  );
  await customerContext.close();

  // The ForwardAuth serves the default host and nothing unknown.
  const check = (host: string) =>
    request.get("/api/domains/check", {
      headers: { "X-Check-Secret": CHECK_SECRET, "X-Forwarded-Host": host },
    });
  expect((await check(`${wsSlug}.quiz.mobio.pro`)).status()).toBe(200);
  expect((await check(`desconhecido-${stamp}.mobio.pro`)).status()).toBe(403);
  expect((await check("www.mobio.pro")).status()).toBe(403);
});
