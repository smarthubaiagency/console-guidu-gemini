/**
 * ============================================================================
 * File: e2e/partner-billing.spec.ts
 * Module: End-to-End Tests for manual billing (ADR 0012, P5m, D-PA-14)
 *
 * Maintenance Rationale:
 * - A partner (seeded with an active `*.localhost` domain) opens the plan of
 *   a customer and records a monthly payment with evidence in
 *   /admin/billing; the subscription goes from pending to active.
 * - The customer sees the plan and the partner's contact in
 *   /app/[slug]/settings/billing, and no checkout while the switch is off;
 *   a direct visit to the checkout answers 404 (criteria 9 and 11).
 * - With a partner plan, terms and privacy published, the partner turns the
 *   switch on and the customer goes through the demonstration checkout,
 *   which charges nothing.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  seedPartner,
  seedWorkspace,
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

/**
 * Opens a page and waits for one of its elements. The e2e database is PGlite
 * behind a socket, which sometimes fails concurrent queries ("portal does not
 * exist"); the page then shows the generic error and a reload recovers. A
 * real server error repeats on reload and still fails the test.
 */
async function openPage(
  page: Page,
  path: string,
  testId: string,
): Promise<void> {
  await page.goto(path);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ready = page.getByTestId(testId);
    const failed = page.getByRole("heading", {
      name: "This page couldn’t load",
    });
    await expect(ready.or(failed)).toBeVisible();
    if (await ready.isVisible()) return;
    await page.reload();
  }
  await expect(page.getByTestId(testId)).toBeVisible();
}

const EVIDENCE = {
  name: "comprovante.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% comprovante de teste\n%%EOF\n"),
};

test("partner activates a customer with a manual payment; the checkout stays a demonstration", async ({
  request,
  browser,
}) => {
  // Two identities on the partner host.
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const host = `cobranca-${stamp}.localhost`;
  const ownerEmail = uniqueEmail("billing-owner");
  const customerEmail = uniqueEmail("billing-customer");
  const workspaceSlug = `cobranca-${stamp}`;

  await createIdentity(request, customerEmail);
  const { organizationId } = await seedWorkspace(request, {
    email: customerEmail,
    orgName: `Cliente Cobrança ${stamp}`,
    orgSlug: workspaceSlug,
    wsName: "Operação Cobrança",
    wsSlug: workspaceSlug,
  });
  await createIdentity(request, ownerEmail);
  await seedPartner(request, {
    slug: `cobranca-${stamp}`,
    name: "Agência Cobrança",
    host,
    memberEmail: ownerEmail,
    role: "partner_owner",
    organizationId,
  });

  const partnerContext = await browser.newContext({
    baseURL: `http://${host}:3000`,
  });
  const owner = await partnerContext.newPage();
  await signIn(owner, ownerEmail);
  await enrolMfa(owner);

  // Open the plan: pending until the first payment (criterion 10).
  await openPage(owner, "/admin/billing", "partner-billing");
  const customerRow = owner
    .getByTestId("billing-customers")
    .getByRole("listitem")
    .filter({ hasText: `Cliente Cobrança ${stamp}` });
  await expect(customerRow).toContainText("Sem plano");
  const start = owner.getByTestId(`start-subscription-${organizationId}`);
  await start.getByRole("button", { name: "Abrir assinatura" }).click();
  // The page refreshes: the form gives way to the pending subscription.
  await expect(customerRow.getByTestId("subscription-status")).toHaveText(
    "Aguardando pagamento",
  );

  // Record the monthly payment with evidence.
  await customerRow
    .getByText("Registrar pagamento", { exact: true })
    .first()
    .click();
  const payment = owner.getByTestId(`record-payment-${organizationId}`);
  await expect(payment.getByLabel("Valor pago (R$)")).toHaveValue("30,00");
  await payment.getByLabel(/Comprovante/).setInputFiles(EVIDENCE);
  await payment.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(payment.getByRole("status")).toContainText(
    "Pagamento registrado.",
  );
  await owner.reload();
  await expect(customerRow.getByTestId("subscription-status")).toHaveText(
    "Ativa",
  );
  const payments = owner.getByTestId("billing-payments");
  await expect(payments).toContainText("R$ 30,00");
  const evidenceHref = await payments
    .getByRole("link", { name: "Comprovante" })
    .first()
    .getAttribute("href");
  // Fetched from the page: the browser resolves *.localhost, Node does not.
  const evidence = await owner.evaluate(async (href) => {
    const response = await fetch(href);
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      start: (await response.text()).slice(0, 5),
    };
  }, evidenceHref!);
  expect(evidence).toEqual({
    status: 200,
    type: "application/pdf",
    start: "%PDF-",
  });

  // The customer sees the plan and the partner contact, never a checkout.
  const customerContext = await browser.newContext({
    baseURL: `http://${host}:3000`,
  });
  const customer = await customerContext.newPage();
  await signIn(customer, customerEmail);
  await openPage(
    customer,
    `/app/${workspaceSlug}/settings/billing`,
    "workspace-billing",
  );
  const billing = customer.getByTestId("workspace-billing");
  await expect(billing).toContainText("Plano Essencial");
  await expect(billing.getByTestId("subscription-status")).toHaveText("Ativa");
  await expect(billing.getByTestId("billing-contact")).toContainText(
    "Agência Cobrança",
  );
  await expect(
    billing.getByRole("link", { name: "Abrir checkout de demonstração" }),
  ).toHaveCount(0);
  const checkoutPath = `/app/${workspaceSlug}/settings/billing/checkout`;
  const closedStatus = await customer.evaluate(async (path) => {
    const response = await fetch(path, { redirect: "manual" });
    return response.status;
  }, checkoutPath);
  expect(closedStatus).toBe(404);

  // The switch needs a partner plan at or above the floor, terms and privacy.
  await openPage(owner, "/admin/billing", "partner-billing");
  const switchCard = owner.getByTestId("checkout-switch");
  await switchCard.getByRole("button", { name: "Ativar checkout" }).click();
  await expect(switchCard.getByRole("alert")).toContainText(
    "Para ativar o checkout falta",
  );

  const plan = owner.getByTestId("create-partner-plan");
  await plan.getByLabel("Nome").fill("Completo");
  await plan.getByLabel("Preço (R$)").fill("99,99");
  await plan.getByRole("button", { name: "Criar plano" }).click();
  await expect(plan.getByRole("alert")).toContainText("abaixo do piso");
  // The form resets after each submit, as every action form does.
  await plan.getByLabel("Nome").fill("Completo");
  await plan.getByLabel("Preço (R$)").fill("150,00");
  await plan.getByRole("button", { name: "Criar plano" }).click();
  await expect(plan.getByRole("status")).toContainText("Plano criado");

  await owner.goto("/admin/legal");
  const publish = owner.getByTestId("publish-legal");
  for (const [kind, title] of [
    ["Termos de uso", "Termos da Agência Cobrança"],
    ["Política de privacidade", "Privacidade da Agência Cobrança"],
  ] as const) {
    await publish.getByLabel("Documento").selectOption({ label: kind });
    await publish.getByLabel("Título").fill(title);
    await publish.getByLabel("Texto").fill("Cláusula única de teste.");
    await publish.getByRole("button", { name: "Publicar" }).click();
    await expect(owner.getByTestId("legal-versions")).toContainText(title);
  }

  await openPage(owner, "/admin/billing", "partner-billing");
  await switchCard.getByRole("button", { name: "Ativar checkout" }).click();
  await expect(switchCard.getByRole("status")).toContainText(
    "Checkout ativado",
  );

  // The customer accepts the new terms and goes through the demonstration.
  await customer.goto(`/app/${workspaceSlug}/settings/billing`);
  await expect(customer).toHaveURL(/\/legal\/accept\?next=/);
  await customer.getByLabel("Li e aceito os documentos acima.").check();
  await customer.getByRole("button", { name: "Aceitar e continuar" }).click();
  // The acceptance returns to the workspace, as the P4b2 gate does.
  await expect(customer).toHaveURL(new RegExp(`/app/${workspaceSlug}$`));
  await openPage(
    customer,
    `/app/${workspaceSlug}/settings/billing`,
    "workspace-billing",
  );
  await billing
    .getByRole("link", { name: "Abrir checkout de demonstração" })
    .click();
  const checkout = customer.getByTestId("demo-checkout");
  await expect(checkout.getByRole("note")).toContainText(
    "nenhuma cobrança é feita",
  );
  await expect(checkout).toContainText("R$ 150,00");
  await checkout.getByRole("button", { name: "Simular contratação" }).click();
  await expect(checkout.getByRole("status")).toContainText(
    "nenhuma cobrança foi feita",
  );

  // Nothing was charged: still one payment, and the switch off closes it again.
  await openPage(owner, "/admin/billing", "partner-billing");
  await expect(payments.getByRole("listitem")).toHaveCount(1);
  await switchCard.getByRole("button", { name: "Desativar checkout" }).click();
  await expect(switchCard.getByRole("status")).toContainText(
    "Checkout desativado",
  );
  const reclosed = await customer.evaluate(async (path) => {
    const response = await fetch(path, { redirect: "manual" });
    return response.status;
  }, checkoutPath);
  expect(reclosed).toBe(404);

  await customerContext.close();
  await partnerContext.close();
});
