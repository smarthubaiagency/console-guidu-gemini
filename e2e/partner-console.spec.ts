/**
 * ============================================================================
 * File: e2e/partner-console.spec.ts
 * Module: End-to-End Tests for partners (ADR 0012, P4a)
 *
 * Maintenance Rationale:
 * - The platform owner creates a partner, activates a domain and invites its
 *   owner from /platform/partners.
 * - The invited owner signs in on the partner domain (a `*.localhost` host,
 *   which the browser resolves to loopback), accepts the invitation, opens
 *   the partner console at /admin and saves the partner brand.
 * - The platform host keeps its own brand: brands never cross hosts.
 * - P4b: the owner offers a module, builds a template and registers a
 *   customer, whose owner accepts on the partner domain and lands in the
 *   workspace with the template module and the partner brand.
 * - P4b2: terms published by the partner are accepted on the next access;
 *   support access is requested, approved, used as viewer and revoked.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { totpCode } from "./support/totp";

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

test("platform creates a partner whose owner runs the console on the partner domain", async ({
  page,
  request,
  browser,
}) => {
  // Three identities on two hosts: longer than the default budget.
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const slug = `agencia-${stamp}`;
  const host = `${slug}.localhost`;
  const ownerEmail = uniqueEmail("partner-owner");

  // Platform owner.
  const platformEmail = uniqueEmail("platform-owner");
  await createIdentity(request, platformEmail);
  await makePlatformAdmin(request, platformEmail);
  await signIn(page, platformEmail);
  await enrolMfa(page);

  await page.goto("/platform/partners");
  const create = page.getByTestId("create-partner");
  await create.getByLabel("Nome").fill("Agência E2E");
  await create.getByLabel("Identificador").fill(slug);
  await create.getByRole("button", { name: "Criar parceiro" }).click();
  await page.waitForURL(/\/platform\/partners\/[0-9a-f-]{36}$/);

  const domain = page.getByTestId("add-domain");
  await domain.getByLabel("Domínio ou nome do subdomínio").fill(host);
  await domain.getByRole("button", { name: "Cadastrar domínio" }).click();
  await expect(domain.getByRole("status")).toContainText("pendente");
  await page.reload();
  await page.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByText("Domínio ativado.")).toBeVisible();

  const invite = page.getByTestId("invite-partner-member");
  await invite.getByLabel("E-mail").fill(ownerEmail);
  await invite.getByRole("button", { name: "Gerar convite" }).click();
  const inviteUrl = (
    await invite.getByTestId("partner-invite-url").textContent()
  )?.trim();
  expect(inviteUrl).toMatch(
    new RegExp(`^http://${host}:3000/partner-invite/[0-9a-f]{64}$`),
  );

  // Partner owner, on the partner domain.
  const partnerContext = await browser.newContext({
    baseURL: `http://${host}:3000`,
  });
  const owner = await partnerContext.newPage();
  await createIdentity(request, ownerEmail);
  await signIn(owner, ownerEmail);
  await enrolMfa(owner);

  await owner.goto(inviteUrl!);
  await expect(
    owner.getByRole("heading", { name: "Entrar em Agência E2E" }),
  ).toBeVisible();
  await owner.getByRole("button", { name: "Aceitar convite" }).click();
  await owner.waitForURL(/\/admin$/);
  await expect(owner.getByTestId("partner-console")).toBeVisible();
  await expect(
    owner.getByRole("heading", { name: "Agência E2E" }),
  ).toBeVisible();

  // The owner sees the members page with themself as owner.
  await owner.goto("/admin/members");
  await expect(owner.getByTestId("partner-member-list")).toContainText(
    `${ownerEmail.toLowerCase()} (você)`,
  );

  // Partner brand, served only on the partner domain.
  await owner.goto("/admin/brand");
  await owner.getByLabel("Nome exibido").fill("Marca Agência E2E");
  await owner.getByLabel("Cor primária (#rrggbb, opcional)").fill("#6a1b9a");
  await owner.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(
    owner.getByTestId("brand-form").getByRole("status"),
  ).toContainText("Marca salva");
  await owner.reload();
  await expect(owner.getByTestId("brand-current-name")).toHaveText(
    "Marca Agência E2E",
  );
  await expect(owner.locator("header").first()).toContainText(
    "Marca Agência E2E",
  );

  // The platform host keeps the platform brand, and /platform does not exist
  // on the partner domain.
  await page.goto("/platform/brand");
  await expect(page.getByTestId("brand-current-name")).not.toHaveText(
    "Marca Agência E2E",
  );
  // Fetched from the page: the browser resolves *.localhost, Node does not.
  const platformStatus = await owner.evaluate(async () => {
    const response = await fetch("/platform", { redirect: "manual" });
    return response.status;
  });
  expect(platformStatus).toBe(404);

  // P4b: offer a module, build a template and register a customer.
  await owner.goto("/admin/modules");
  const helloRow = owner
    .getByTestId("partner-modules")
    .getByRole("listitem")
    .filter({ hasText: "Hello" });
  await helloRow.getByRole("button", { name: "Oferecer" }).click();
  await expect(helloRow.getByRole("status")).toContainText("Módulo oferecido.");

  await owner.goto("/admin/templates");
  const template = owner.getByTestId("create-template");
  await template.getByLabel("Nome").fill("Padrão E2E");
  await template.getByRole("checkbox").first().check();
  await template.getByRole("button", { name: "Criar modelo" }).click();
  await expect(template.getByRole("status")).toContainText("Modelo criado.");

  const customerEmail = uniqueEmail("customer-owner");
  const customerSlug = `cliente-${stamp}`;
  await owner.goto("/admin/customers");
  const customer = owner.getByTestId("create-customer");
  await customer.getByLabel("Empresa").fill("Cliente E2E");
  await customer.getByLabel("E-mail do responsável").fill(customerEmail);
  await customer.getByLabel("Nome do workspace").fill("Operação E2E");
  await customer.getByLabel("Endereço do workspace").fill(customerSlug);
  await customer.getByLabel("Modelo de workspace").selectOption({
    label: "Padrão E2E",
  });
  await customer.getByRole("button", { name: "Cadastrar cliente" }).click();
  const customerInvite = (
    await customer.getByTestId("partner-invite-url").textContent()
  )?.trim();
  expect(customerInvite).toMatch(
    new RegExp(`^http://${host}:3000/invite/[0-9a-f]{64}$`),
  );
  await owner.reload();
  await expect(owner.getByTestId("partner-customers")).toContainText(
    "Cliente E2E",
  );

  // The customer owner accepts on the partner domain and lands in the
  // workspace with the template's module and the partner brand.
  const customerContext = await browser.newContext({
    baseURL: `http://${host}:3000`,
  });
  const customerPage = await customerContext.newPage();
  await createIdentity(request, customerEmail);
  await signIn(customerPage, customerEmail);
  await customerPage.goto(customerInvite!);
  await expect(customerPage.getByText("Cliente E2E")).toBeVisible();
  await customerPage.getByRole("button", { name: "Aceitar Convite" }).click();
  await expect(customerPage).toHaveURL(new RegExp(`/app/${customerSlug}$`));
  await expect(
    customerPage.getByRole("heading", { name: "Operação E2E" }),
  ).toBeVisible();
  await expect(customerPage.locator("header").first()).toContainText(
    "Marca Agência E2E",
  );
  await expect(
    customerPage.getByRole("link", { name: /Hello/ }).first(),
  ).toBeVisible();

  // P4b2: the partner publishes terms; the customer accepts on next access.
  await owner.goto("/admin/legal");
  const publish = owner.getByTestId("publish-legal");
  await publish.getByLabel("Título").fill("Termos da Agência E2E");
  await publish.getByLabel("Texto").fill("Cláusula única de teste.");
  await publish.getByRole("button", { name: "Publicar" }).click();
  await expect(publish.getByRole("status")).toContainText(
    "Versão 1 publicada.",
  );

  await customerPage.goto(`/app/${customerSlug}`);
  await expect(customerPage).toHaveURL(/\/legal\/accept\?next=/);
  await expect(customerPage.getByText("Termos da Agência E2E")).toBeVisible();
  await customerPage.getByLabel("Li e aceito os documentos acima.").check();
  await customerPage
    .getByRole("button", { name: "Aceitar e continuar" })
    .click();
  await expect(customerPage).toHaveURL(new RegExp(`/app/${customerSlug}$`));

  // P4b2: temporary support access, approved and revoked by the customer.
  await owner.goto("/admin/support");
  const support = owner.getByTestId("request-support");
  await support.getByLabel("Motivo").fill("Ajudar na configuração inicial");
  await support.getByRole("button", { name: "Pedir acesso" }).click();
  await expect(support.getByRole("status")).toContainText("Pedido enviado");

  await customerPage.goto(`/app/${customerSlug}/settings/support`);
  const grants = customerPage.getByTestId("workspace-support-grants");
  await expect(grants).toContainText("Ajudar na configuração inicial");
  await grants.getByRole("button", { name: "Aprovar" }).click();
  await expect(grants).toContainText("Aprovado até");

  await owner.goto("/admin/support");
  await owner.getByRole("link", { name: "Abrir workspace" }).click();
  // The partner member also accepts the partner terms before /app.
  await expect(owner).toHaveURL(/\/legal\/accept\?next=/);
  await owner.getByLabel("Li e aceito os documentos acima.").check();
  await owner.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(owner).toHaveURL(new RegExp(`/app/${customerSlug}$`));
  await expect(
    owner.getByRole("heading", { name: "Operação E2E" }),
  ).toBeVisible();

  await customerPage.reload();
  await grants.getByRole("button", { name: "Revogar" }).click();
  await expect(grants).toContainText("Encerrado");
  const afterRevoke = await owner.evaluate(async (path) => {
    const response = await fetch(path, { redirect: "manual" });
    return response.status;
  }, `/app/${customerSlug}`);
  expect(afterRevoke).toBe(404);

  await customerContext.close();
  await partnerContext.close();
});
