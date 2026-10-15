/**
 * ============================================================================
 * File: e2e/billing-gateway.spec.ts
 * Module: End-to-End Tests for Cobrança › Gateway (CF7)
 *
 * Maintenance Rationale:
 * - A platform owner opens Cobrança, goes to the Gateway tab and finds
 *   Stripe Connect off, with its capabilities and real charging off.
 * - The credentials are saved and come back masked only; the page never
 *   holds the secrets. Stripe is turned on as the default gateway.
 * - "Enviar webhook de teste" signs an event with the saved secret and
 *   posts it to the route through APP_URL: it shows in the health card.
 * - A signed event of the other mode is stored as failed; "Reprocessar
 *   falhas" tries it again (still failing in test mode). A wrong signature
 *   is refused and stored nowhere. The history lists the changes.
 * - Stripe is turned off again at the end. No call reaches Stripe.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import { signStripePayload } from "../src/core/billing/gateway/stripe-signature";
import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { RIG } from "./support/rig";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

const SECRET_KEY = `sk_test_${"e2e7".repeat(8)}`;
const WEBHOOK_SECRET = "whsec_e2eCf7WebhookSecret0123456789";
const WEBHOOK = "/api/billing/stripe/webhook";

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

test("platform billing configures Stripe Connect and watches its webhook", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const owner = uniqueEmail("gateway-owner");
  await createIdentity(request, owner);
  await makePlatformAdmin(request, owner);
  await signIn(page, owner);
  await enrolMfa(page);

  await page.goto("/platform/billing");
  await expect(page.getByTestId("billing-tabs")).toBeVisible();
  await page
    .getByTestId("billing-tabs")
    .getByRole("link", { name: "Gateway" })
    .click();
  await expect(page).toHaveURL(/\/platform\/billing\/gateway$/);
  await expect(page.getByTestId("gateway-status")).toContainText("Desligado");
  await expect(page.getByTestId("gateway-charging")).toContainText(
    "Desligada até a P6",
  );
  await expect(page.getByTestId("gateway-capabilities")).toContainText(
    "Divisão (split)",
  );
  await expect(page.getByTestId("gateway-webhook-url")).toHaveValue(
    `${RIG.appUrl}${WEBHOOK}`,
  );

  try {
    // Credentials: saved, then shown masked only.
    await page.waitForLoadState("networkidle");
    const credentials = page.getByTestId("gateway-credentials");
    await credentials
      .getByLabel("Nova chave secreta (sk_ ou rk_)")
      .fill(SECRET_KEY);
    await credentials
      .getByLabel("Novo segredo do webhook (whsec_)")
      .fill(WEBHOOK_SECRET);
    await credentials.getByRole("button", { name: "Salvar" }).click();
    await expect(statusBanner(page)).toContainText("Credenciais salvas.");
    await page.reload();
    await expect(page.getByTestId("gateway-secret-key")).toContainText(
      "sk_test_...e2e7",
    );
    await expect(page.getByTestId("gateway-webhook-secret")).toContainText(
      "whsec_...6789",
    );
    const html = await page.content();
    expect(html).not.toContain(SECRET_KEY);
    expect(html).not.toContain(WEBHOOK_SECRET);

    // On, as the default gateway, in test mode.
    await page.waitForLoadState("networkidle");
    const stripe = page.getByTestId("gateway-stripe");
    await stripe.getByLabel("Ligar o Stripe Connect").check();
    await stripe.getByLabel("Usar como gateway padrão").check();
    await stripe.getByRole("button", { name: "Salvar" }).click();
    await expect(statusBanner(page)).toContainText("Gateway salvo.");
    await expect(page.getByTestId("gateway-status")).toContainText("Ligado");

    // The test webhook goes through the route.
    await page
      .getByTestId("gateway-test-form")
      .getByRole("button", { name: "Enviar webhook de teste" })
      .click();
    await expect(statusBanner(page)).toContainText(
      "Webhook de teste recebido e processado.",
    );
    await page.reload();
    await expect(page.getByTestId("gateway-received")).toContainText("1");
    await expect(page.getByTestId("gateway-events")).toContainText(
      "guidu.webhook_test",
    );

    // A wrong signature is refused and stored nowhere.
    const forged = JSON.stringify({
      id: "evt_e2e_forged",
      type: "invoice.paid",
      livemode: false,
    });
    const refused = await request.post(WEBHOOK, {
      data: forged,
      headers: {
        "content-type": "application/json",
        "stripe-signature": signStripePayload(
          forged,
          "whsec_wrongSecret0123456",
        ),
      },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toEqual({ error: "Invalid signature." });

    // A live event while in test mode is kept as failed, twice idempotent.
    const live = JSON.stringify({
      id: "evt_e2e_live",
      type: "invoice.paid",
      livemode: true,
    });
    for (let i = 0; i < 2; i += 1) {
      const delivered = await request.post(WEBHOOK, {
        data: live,
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(live, WEBHOOK_SECRET),
        },
      });
      expect(delivered.status()).toBe(200);
    }
    await page.reload();
    await expect(page.getByTestId("gateway-received")).toContainText("2");
    await expect(page.getByTestId("gateway-failed")).toContainText("1");
    await expect(page.getByTestId("gateway-events")).not.toContainText(
      "evt_e2e_forged",
    );
    await page.waitForLoadState("networkidle");
    await page
      .getByTestId("gateway-reprocess-form")
      .getByRole("button", { name: "Reprocessar falhas" })
      .click();
    await expect(statusBanner(page)).toContainText(
      "Reprocessamento concluído: 0 processados, 1 ainda com falha.",
    );

    // The history comes from the audit trail.
    await page.reload();
    const history = page.getByTestId("gateway-history");
    await expect(history).toContainText("Credenciais trocadas");
    await expect(history).toContainText("Configuração alterada");
    await expect(history).toContainText("Webhook de teste enviado");
    await expect(history).not.toContainText(WEBHOOK_SECRET);
  } finally {
    await page.goto("/platform/billing/gateway");
    await page.waitForLoadState("networkidle");
    const stripe = page.getByTestId("gateway-stripe");
    await stripe.getByLabel("Usar como gateway padrão").uncheck();
    await stripe.getByLabel("Ligar o Stripe Connect").uncheck();
    await stripe.getByRole("button", { name: "Salvar" }).click();
    await expect(statusBanner(page)).toContainText("Gateway salvo.");
  }

  // Off: the webhook refuses everything.
  const off = await request.post(WEBHOOK, {
    data: "{}",
    headers: { "content-type": "application/json" },
  });
  expect(off.status()).toBe(404);
});
