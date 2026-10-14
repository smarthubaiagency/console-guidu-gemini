/**
 * ============================================================================
 * File: e2e/domains.spec.ts
 * Module: End-to-End Tests for the custom domains (CF2b)
 *
 * Maintenance Rationale:
 * - A partner owner adds its own dashboard domain in /admin › Configurações ›
 *   Domínios, sees the CNAME instructions, verifies (the DNS does not point
 *   yet, so it stays pending) and removes it.
 * - A customer's public domain respects the plan: without a limit the
 *   partner is refused and the workspace owner sees no form in /app.
 * - The Traefik ForwardAuth answers 200 only with the secret and a served
 *   host; everything else is 403.
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

const CHECK_SECRET = "e2e-domains-check-secret";

test("a partner manages its dashboard domain and its customers' domains", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);

  // The customer: a workspace of an organization moved to the partner.
  const customerEmail = uniqueEmail("dominio-cliente");
  await createIdentity(request, customerEmail);
  const workspace = await seedWorkspace(request, {
    email: customerEmail,
    orgName: `Loja ${stamp}`,
    orgSlug: `loja-dominio-${stamp}`,
    wsName: "Loja",
    wsSlug: `loja-dominio-${stamp}`,
  });

  const partnerHost = `dominios-${stamp}.localhost`;
  const ownerEmail = uniqueEmail("dominio-parceiro");
  await createIdentity(request, ownerEmail);
  await seedPartner(request, {
    slug: `dominios-${stamp}`,
    name: `Agência ${stamp}`,
    host: partnerHost,
    memberEmail: ownerEmail,
    role: "partner_owner",
    organizationId: workspace.organizationId,
  });

  const context = await browser.newContext({
    baseURL: `http://${partnerHost}:3000`,
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
  const dashboard = admin.getByTestId("partner-domains");
  await expect(dashboard.locator(`[data-host="${partnerHost}"]`)).toContainText(
    "Subdomínio da plataforma",
  );

  const custom = `console.agencia-${stamp}.test`;
  await dashboard.getByLabel("Domínio").fill(`https://${custom}/login`);
  await dashboard.getByRole("button", { name: "Adicionar domínio" }).click();
  await expect(statusBanner(admin)).toContainText(
    `Domínio ${custom} adicionado`,
  );
  const row = dashboard.locator(`[data-host="${custom}"]`);
  await expect(row.getByTestId("domain-status")).toHaveText("Pendente");
  await expect(row.getByTestId("domain-instructions")).toContainText(
    "proxy.guidu.test",
  );

  await row.getByRole("button", { name: "Verificar" }).click();
  await expect(statusBanner(admin)).toContainText(
    "O CNAME ainda não aponta para o destino",
  );
  await expect(row.getByTestId("domain-status")).toHaveText("Pendente");
  await expect(row.getByTestId("domain-last-check")).toBeVisible();

  // A pending domain is not served yet.
  const pendingCheck = await request.get("/api/domains/check", {
    headers: { "X-Check-Secret": CHECK_SECRET, "X-Forwarded-Host": custom },
  });
  expect(pendingCheck.status()).toBe(403);

  await row.getByTestId("domain-remove").click();
  const question = statusBanner(admin);
  await expect(question).toHaveAttribute("role", "alertdialog");
  await expect(question).toContainText(`Remover o domínio ${custom}?`);
  await question.getByTestId("smart-status-action").click();
  await expect(statusBanner(admin)).toContainText(`Domínio ${custom} removido`);
  await expect(row).toHaveCount(0);

  // The customer's plan has no public domain: the partner is refused.
  const customers = admin.getByTestId("customer-domains");
  await customers.getByLabel("Domínio").fill(`perfil.loja-${stamp}.test`);
  await customers.getByRole("button", { name: "Adicionar domínio" }).click();
  await expect(statusBanner(admin)).toContainText("Limite do plano atingido");
  await context.close();

  // And the workspace owner, on the partner's host (a partner's customer
  // only opens there), sees the plan note instead of the form.
  const customerContext = await browser.newContext({
    baseURL: `http://${partnerHost}:3000`,
  });
  const page = await customerContext.newPage();
  await signIn(page, customerEmail);
  await page.goto(`/app/loja-dominio-${stamp}/settings/domains`);
  await expect(page.getByTestId("domain-quota")).toHaveText(
    "O plano atual não inclui domínio próprio. Fale com quem administra a sua conta.",
  );
  await expect(page.getByTestId("add-workspace-domain")).toHaveCount(0);
  await customerContext.close();
});

test("the ForwardAuth serves only known hosts with the shared secret", async ({
  request,
}) => {
  const stamp = Date.now().toString(36);
  const host = `forward-${stamp}.localhost`;
  const email = uniqueEmail("dominio-forward");
  await createIdentity(request, email);
  await seedPartner(request, {
    slug: `forward-${stamp}`,
    name: `Agência ${stamp}`,
    host,
    memberEmail: email,
    role: "partner_support",
  });

  const check = (headers: Record<string, string>) =>
    request.get("/api/domains/check", { headers });

  expect((await check({ "X-Forwarded-Host": host })).status()).toBe(403);
  expect(
    (
      await check({
        "X-Check-Secret": "segredo-errado",
        "X-Forwarded-Host": host,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await check({
        "X-Check-Secret": CHECK_SECRET,
        "X-Forwarded-Host": `${host}:443`,
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await check({
        "X-Check-Secret": CHECK_SECRET,
        "X-Forwarded-Host": `desconhecido-${stamp}.test`,
      })
    ).status(),
  ).toBe(403);
});
