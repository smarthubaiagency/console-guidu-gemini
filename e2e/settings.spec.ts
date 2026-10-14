/**
 * ============================================================================
 * File: e2e/settings.spec.ts
 * Module: End-to-End Tests for the settings pages (CF1)
 *
 * Maintenance Rationale:
 * - The settings of each level open in two cards: the submenu on the left
 *   and the content on the right; the sidebar keeps one "Configurações".
 * - A workspace owner sets its own currency, sees it apply and goes back
 *   to inheriting.
 * - A platform owner saves the offered currencies. The e2e database is
 *   shared, so the platform only saves values equal to the defaults.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { sidebar } from "./support/sidebar";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

test("workspace settings: submenu card and own currency", async ({
  page,
  request,
}) => {
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("settings-owner");
  const wsSlug = `cfg-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Config ${stamp}`,
    orgSlug: `cfg-org-${stamp}`,
    wsName: `Workspace Config ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}`);

  await sidebar(page).getByRole("link", { name: "Configurações" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${wsSlug}/settings/general$`));
  const nav = page.getByTestId("settings-nav");
  await expect(nav).toContainText("Workspace");
  await expect(nav).toContainText("Canais e integrações");
  await expect(nav.getByRole("link", { name: "Geral" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const region = page.getByTestId("region-settings");
  await expect(region.getByTestId("region-effective-currency")).toContainText(
    "BRL",
  );
  await region
    .locator('select[name="value:region.currency"]')
    .selectOption("USD");
  await region.getByRole("button", { name: "Salvar região" }).click();
  await expect(
    statusBanner(region).filter({ hasText: "Configurações salvas." }),
  ).toBeVisible();
  await expect(region.getByTestId("region-effective-currency")).toContainText(
    "USD",
  );
  await expect(region.getByTestId("region-effective-currency")).toContainText(
    "do workspace",
  );

  // Empty goes back to what the level above sets.
  await region.locator('select[name="value:region.currency"]').selectOption("");
  await region.getByRole("button", { name: "Salvar região" }).click();
  await expect(region.getByTestId("region-effective-currency")).toContainText(
    "BRL",
  );
});

test("platform settings: general and region", async ({ page, request }) => {
  const email = uniqueEmail("settings-platform");
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  await page.goto("/platform");
  await sidebar(page).getByRole("link", { name: "Configurações" }).click();
  await expect(page).toHaveURL(/\/platform\/settings\/general$/);
  await expect(page.getByTestId("platform-info")).toBeVisible();
  const nav = page.getByTestId("settings-nav");
  await expect(nav.getByRole("link", { name: "Idiomas" })).toBeVisible();

  const region = page.getByTestId("region-settings");
  await region.getByLabel("Moedas oferecidas").fill("brl, usd, eur");
  await region.getByRole("button", { name: "Salvar região" }).click();
  await expect(
    statusBanner(region).filter({ hasText: "Configurações salvas." }),
  ).toBeVisible();
  await expect(region.getByLabel("Moedas oferecidas")).toHaveValue(
    "BRL, USD, EUR",
  );
});
