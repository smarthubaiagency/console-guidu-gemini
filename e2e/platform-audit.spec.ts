/**
 * ============================================================================
 * File: e2e/platform-audit.spec.ts
 * Module: End-to-End Tests for Plataforma › Auditoria (AUD1)
 *
 * Maintenance Rationale:
 * - A platform owner with MFA creates an administrative key (an audited
 *   security action), opens Auditoria from the menu, filters by actor and
 *   action prefix, opens the event in the internal drawer (fields,
 *   metadata and the link to the security events), closes it with Esc, is
 *   warned of an inverted period and clears the filters.
 * - A platform billing member sees the "billing only" notice, only billing
 *   actions in the list and nothing for a non-billing prefix.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

const BILLING_ACTION =
  /^(billing\.|platform\.billing\.|partner\.billing\.|partner\.payment\.|partner\.subscription\.|partner\.checkout\.)/;

async function enrolMfa(page: Page): Promise<void> {
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

/** Fills a filter once the page is hydrated (the draft resets on render). */
async function fillFilter(page: Page, label: string, value: string) {
  const field = page
    .getByTestId("audit-filters")
    .getByLabel(label, { exact: true });
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass();
}

test("a platform owner filters the audit trail and opens an event", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("audit-owner");
  const ownerId = await createIdentity(page.request, email);
  await makePlatformAdmin(page.request, email);
  await signIn(page, email);
  await enrolMfa(page);

  // An audited action of this owner: a new administrative key.
  await page.goto("/platform/api-keys");
  const form = page.getByTestId("create-platform-key");
  await form.getByLabel("Nome da chave").fill("E2E Auditoria");
  await form.getByLabel(/Clientes \(admin:customers:read\)/).check();
  await form.getByRole("button", { name: "Criar chave" }).click();
  await expect(page.getByTestId("platform-raw-key")).toBeVisible();

  await page.goto("/platform");
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("link", { name: "Auditoria", exact: true })
    .click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await expect(
    page.getByRole("heading", { name: "Auditoria", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("audit-billing-only")).toHaveCount(0);
  await expect(page.getByTestId("audit-event").first()).toBeVisible();

  await page.waitForLoadState("networkidle");
  await fillFilter(page, "Ator (id)", ownerId);
  await fillFilter(page, "Ação (começa com)", "platform_api_keys.");
  await page.getByTestId("audit-apply").click();
  await expect(page).toHaveURL(/actor=/);
  await expect(page).toHaveURL(/action=platform_api_keys\./);

  const rows = page.getByTestId("audit-event");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute(
    "data-action",
    "platform_api_keys.create",
  );
  await expect(rows.first()).toContainText("Segurança");
  await expect(rows.first()).toContainText("Sucesso");

  await rows.first().getByTestId("audit-event-open").click();
  const detail = page.getByTestId("audit-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(ownerId);
  await expect(detail).toContainText("platform_api_key");
  await expect(page.getByTestId("audit-metadata")).toContainText("scopes");
  await expect(page.getByTestId("audit-metadata")).toContainText(
    "admin:customers:read",
  );
  await expect(page).toHaveURL(/event=[0-9a-f-]{36}/);
  await expect(page.getByTestId("audit-security-link")).toHaveAttribute(
    "href",
    /\/platform\/settings\/security\/events\?before=/,
  );

  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(page).not.toHaveURL(/event=/);

  // An inverted period is refused in the status banner.
  await fillFilter(page, "De", "2026-10-16");
  await fillFilter(page, "Até", "2026-10-01");
  await page.getByTestId("audit-apply").click();
  await expect(statusBanner(page)).toContainText("Período inválido");

  await page.getByTestId("audit-clear").click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await expect(
    page.getByTestId("audit-filters").getByLabel("Ator (id)"),
  ).toHaveValue("");
});

test("a platform billing member sees only billing actions", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("audit-billing");
  await createIdentity(page.request, email);
  await makePlatformAdmin(page.request, email, "billing");
  await signIn(page, email);
  await enrolMfa(page);

  await page.goto("/platform");
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("link", { name: "Auditoria", exact: true })
    .click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await expect(page.getByTestId("audit-billing-only")).toHaveText(
    "Somente cobrança",
  );

  const actions = await page
    .getByTestId("audit-event")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-action") ?? ""),
    );
  for (const action of actions) expect(action).toMatch(BILLING_ACTION);

  // Security and key events exist (the MFA just enrolled, other specs'
  // keys), but never reach billing.
  await page.goto("/platform/audit?action=auth.");
  await expect(page.getByTestId("audit-empty")).toBeVisible();
  await page.goto("/platform/audit?action=platform_api_keys.");
  await expect(page.getByTestId("audit-empty")).toBeVisible();
});
