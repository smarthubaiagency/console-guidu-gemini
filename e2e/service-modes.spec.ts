/**
 * ============================================================================
 * File: e2e/service-modes.spec.ts
 * Module: GB1c — complete service modes (ADR 0020)
 *
 * Maintenance Rationale:
 * - The partner registers a customer in `padrao`; the owner joins by the
 *   invitation and has a contact in the CRM, which the partner cannot see.
 * - The partner asks for the managed mode in /admin › Clientes; the owner
 *   receives the single-use link by e-mail and approves it on the partner's
 *   page, without the dashboard; the link does not work twice.
 * - The partner then sees the workspace and its CRM; the owner goes back to
 *   `padrao` in Configurações › Modo de serviço and the partner loses the
 *   workspace at once.
 * ============================================================================
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  createIdentity,
  runJobs,
  seedCrmContact,
  seedPartner,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

type Sent = { to: string; subject: string; text: string };

async function sentTo(request: APIRequestContext, email: string) {
  const response = await request.get(
    `http://127.0.0.1:${RIG.resendPort}/__sent?to=${encodeURIComponent(email)}`,
  );
  return ((await response.json()) as { sent: Sent[] }).sent;
}

test("partner asks, the owner approves by the link and goes back to padrao", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const host = `gb1c-parceiro-${stamp}.localhost`;
  const baseURL = `http://${host}:${RIG.appPort}`;
  const partnerEmail = uniqueEmail("gb1c-partner");
  await createIdentity(request, partnerEmail);
  await seedPartner(request, {
    slug: `gb1c-parceiro-${stamp}`,
    name: `Agência GB1c ${stamp}`,
    host,
    memberEmail: partnerEmail,
    role: "partner_owner",
  });

  const partnerContext = await browser.newContext({ baseURL, locale: "pt-BR" });
  const partner = await partnerContext.newPage();
  await signIn(partner, partnerEmail);
  await partner.goto("/app/account/security");
  await partner.getByTestId("start-mfa-enrolment").click();
  const secret = (
    await partner.getByTestId("totp-secret").textContent()
  )?.trim();
  await partner.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await partner.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(partner.getByTestId("mfa-factors")).toBeVisible();

  // The partner registers the customer in `padrao`.
  const company = `Padaria GB1c ${stamp}`;
  const ownerEmail = uniqueEmail("gb1c-owner");
  const slug = `padaria-gb1c-${stamp}`;
  await partner.goto("/admin/customers");
  const form = partner.getByTestId("create-customer");
  await form.getByLabel("Empresa").fill(company);
  await form.getByLabel("E-mail do responsável").fill(ownerEmail);
  await form.getByLabel("Nome do workspace").fill("Padaria");
  await form.getByLabel("Endereço do workspace").fill(slug);
  await form.getByLabel("Modo de serviço").selectOption("padrao");
  await form.getByRole("button", { name: "Cadastrar cliente" }).click();
  const invite = (
    await form.getByTestId("partner-invite-url").textContent()
  )?.trim();
  expect(invite).toMatch(/\/invite\/[0-9a-f]{64}$/);

  // The owner joins (no management clause in `padrao`).
  const ownerContext = await browser.newContext({ baseURL, locale: "pt-BR" });
  const owner = await ownerContext.newPage();
  await createIdentity(request, ownerEmail);
  await signIn(owner, ownerEmail);
  await owner.goto(invite!);
  await owner.getByRole("button", { name: "Aceitar Convite" }).click();
  await expect(owner).toHaveURL(new RegExp(`/app/${slug}$`));
  await seedCrmContact(request, { workspaceSlug: slug, name: "Cliente fiel" });

  // `padrao`: the partner sees the company, not its workspace.
  await partner.goto("/admin/customers");
  const row = partner
    .getByTestId("partner-customers")
    .getByRole("listitem")
    .filter({ hasText: company });
  await expect(row).toContainText("Padrão");
  await expect(row.getByTestId("managed-workspaces")).toHaveCount(0);

  // The partner asks for the managed mode.
  await partner.waitForLoadState("networkidle");
  await row
    .getByTestId("request-managed-mode")
    .getByRole("button", { name: "Pedir gerenciamento" })
    .click();
  await expect(statusBanner(partner)).toContainText(
    "Pedido enviado ao owner da empresa.",
  );
  await expect(row.getByTestId("service-mode-request")).toContainText(
    "Pedido pendente até",
  );

  // The dispatch e-mails the single-use link to the owner.
  await expect.poll(() => runJobs(request), { timeout: 60_000 }).toBe(0);
  const mail = (await sentTo(request, ownerEmail)).find((m) =>
    m.subject.includes("pede para gerenciar"),
  );
  expect(mail?.subject).toContain(company);
  const link = /http\S+\/service-mode\/[0-9a-f]{64}/.exec(mail!.text)?.[0];
  expect(link).toBeTruthy();

  // The owner approves on the public page of the partner.
  const anonymous = await browser.newContext({ baseURL, locale: "pt-BR" });
  const page = await anonymous.newPage();
  await page.goto(link!);
  const card = page.getByTestId("service-mode-link");
  await expect(card).toContainText("CRM e contatos");
  await expect(card).toContainText(
    "A chave de IA da empresa nunca é lida nem trocada por quem gerencia.",
  );
  await page.waitForLoadState("networkidle");
  await card.getByRole("button", { name: "Aprovar o gerenciado" }).click();
  await expect(page.getByTestId("service-mode-link-approved")).toBeVisible();
  // Single use: the link only shows the decision.
  await page.reload();
  await expect(page.getByTestId("service-mode-link-approved")).toBeVisible();
  await expect(page.getByTestId("service-mode-link")).toHaveCount(0);
  await anonymous.close();

  // The partner now sees the workspace and its CRM.
  await partner.reload();
  await expect(row).toContainText("Gerenciado");
  await expect(row.getByTestId("managed-crm")).toHaveText("1 contato no CRM");

  // The owner goes back to `padrao`.
  await owner.goto(`/app/${slug}/settings/service-mode`);
  await expect(owner.getByTestId("service-mode-current")).toHaveText(
    "Gerenciado",
  );
  await owner.waitForLoadState("networkidle");
  await owner
    .getByTestId("service-mode-back")
    .getByRole("button", { name: "Voltar para o padrão" })
    .click();
  await expect(statusBanner(owner)).toContainText(
    "A empresa voltou para o modo padrão.",
  );
  await expect(owner.getByTestId("service-mode-current")).toHaveText("Padrão");

  // The partner lost the workspace at once.
  await partner.reload();
  await expect(row).toContainText("Padrão");
  await expect(row.getByTestId("managed-workspaces")).toHaveCount(0);

  await ownerContext.close();
  await partnerContext.close();
});
