/**
 * ============================================================================
 * File: e2e/aj1-adjustments.spec.ts
 * Module: AJ1 — ajustes da H2 e da GB1c (ADR 0020, ADR 0022)
 *
 * Maintenance Rationale:
 * - "Devolver ao padrão": the partner manages a customer (asked and
 *   approved by the link, as in service-modes.spec.ts), then gives it back
 *   in /admin › Clientes with a reason in the confirmation dialog (a short
 *   reason is a field error); the result goes to the SmartStatusBanner,
 *   the partner loses the workspace at once and the owner gets the e-mail
 *   with the reason.
 * - Access to several events at once: the platform support ticks two
 *   events of one workspace in /platform › Eventos (an event of another
 *   workspace cannot join), sends one request, and the owner sees a
 *   single request for 2 events in Eventos.
 * ============================================================================
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  runJobs,
  seedCrmContact,
  seedEvent,
  seedPartner,
  seedWorkspace,
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

test("the partner gives a managed customer back to padrao with a reason", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const host = `aj1-parceiro-${stamp}.localhost`;
  const baseURL = `http://${host}:${RIG.appPort}`;
  const partnerEmail = uniqueEmail("aj1-partner");
  await createIdentity(request, partnerEmail);
  await seedPartner(request, {
    slug: `aj1-parceiro-${stamp}`,
    name: `Agência AJ1 ${stamp}`,
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
  const company = `Padaria AJ1 ${stamp}`;
  const ownerEmail = uniqueEmail("aj1-owner");
  const slug = `padaria-aj1-${stamp}`;
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

  // "Devolver ao padrão" with a reason.
  await partner.waitForLoadState("networkidle");
  await row.getByTestId("revert-managed-mode").click();
  const dialog = partner.getByTestId("revert-managed-mode-dialog");
  await expect(dialog).toContainText(`Devolver ${company} ao padrão?`);
  await dialog.getByLabel("Motivo").fill("curto");
  await dialog.getByTestId("revert-managed-mode-confirm").click();
  await expect(dialog.getByTestId("revert-reason-error")).toHaveText(
    "Escreva o motivo (de 10 a 500 caracteres).",
  );
  await dialog.getByLabel("Motivo").fill("Fim do contrato com a agência");
  await dialog.getByTestId("revert-managed-mode-confirm").click();
  await expect(statusBanner(partner)).toContainText(
    "A empresa voltou para o modo padrão. O owner foi avisado.",
  );

  // The partner lost the workspace at once.
  await expect(row).toContainText("Padrão");
  await expect(row.getByTestId("managed-workspaces")).toHaveCount(0);
  await expect(row.getByTestId("revert-managed-mode")).toHaveCount(0);

  // The owner hears by e-mail, with the reason, and sees the mode.
  await expect.poll(() => runJobs(request), { timeout: 60_000 }).toBe(0);
  const notice = (await sentTo(request, ownerEmail)).find((m) =>
    m.subject.includes("encerrou o gerenciamento"),
  );
  expect(notice?.subject).toContain(company);
  expect(notice?.text).toContain("Fim do contrato com a agência");
  await owner.goto(`/app/${slug}/settings/service-mode`);
  await expect(owner.getByTestId("service-mode-current")).toHaveText("Padrão");

  await ownerContext.close();
  await partnerContext.close();
});

test("the platform asks access to several events of one workspace at once", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("aj1-events");
  const stamp = Date.now();
  const wsSlug = `ws-aj1-${stamp}`;
  const otherSlug = `ws-aj1-outra-${stamp}`;
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Empresa AJ1 ${stamp}`,
    orgSlug: `org-aj1-${stamp}`,
    wsName: "Loja AJ1",
    wsSlug,
    role: "owner",
  });
  await seedWorkspace(request, {
    email,
    orgName: `Outra AJ1 ${stamp}`,
    orgSlug: `org-aj1-outra-${stamp}`,
    wsName: "Outra AJ1",
    wsSlug: otherSlug,
    role: "owner",
  });
  const seed = (workspaceSlug: string, agentName: string) =>
    seedEvent(request, {
      workspaceSlug,
      type: "ai.agent.key_backup",
      module: "ai_agents",
      data: { workspaceName: "Loja AJ1", agentName },
    });
  const { id: first } = await seed(wsSlug, "Agente 1");
  const { id: second } = await seed(wsSlug, "Agente 2");
  const { id: other } = await seed(otherSlug, "Agente 3");

  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  await page.goto("/platform/events?type=ai.agent.key_backup");
  await expect(page.getByTestId("event-list")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const tick = (eventId: string) =>
    page
      .locator(`a[href*="event=${eventId}"]`)
      .locator("xpath=..")
      .getByTestId("event-select");
  await tick(first).click();
  // Another workspace cannot join the request.
  await expect(tick(other)).toBeDisabled();
  await tick(second).click();
  const bar = page.getByTestId("event-selection-bar");
  await expect(bar).toContainText("2 eventos selecionados");
  await bar.getByTestId("event-selection-request").click();

  const access = page.getByRole("dialog").getByTestId("access-request");
  await access
    .getByLabel("Motivo")
    .fill("Chamado 7001 sobre os avisos da chave");
  await access.getByLabel("Referência da solicitação").fill("CH-7001");
  await access.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(statusBanner(page)).toContainText(
    "Pedido de acesso enviado ao cliente.",
  );
  await expect(bar).not.toContainText("selecionados");
  await expect(tick(other)).toBeEnabled();

  // One request for the two events reaches the owner.
  await expect.poll(() => runJobs(request), { timeout: 60_000 }).toBe(0);
  await page.goto(`/app/${wsSlug}/events`);
  const grant = page.getByTestId("access-grant");
  await expect(grant).toHaveCount(1);
  await expect(grant).toContainText("CH-7001");
  await expect(grant).toContainText("2 eventos");
});
