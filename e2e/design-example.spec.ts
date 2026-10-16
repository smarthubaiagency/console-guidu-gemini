/**
 * ============================================================================
 * File: e2e/design-example.spec.ts
 * Module: End-to-End Tests for the model page (U4, ADR 0021)
 *
 * Maintenance Rationale:
 * - Plataforma › Padrões de interface › Página modelo rebuilds the two
 *   reference pages with the model components only. The page sits on the
 *   grey canvas, the segmented tabs, card accordion, period filter and tags
 *   respond, and nothing reads or writes data.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { expandSidebarGroup, sidebar } from "./support/sidebar";
import { totpCode } from "./support/totp";

test("the model page is built from the model components", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail("model-page");
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
  await expandSidebarGroup(page, "Padrões de interface");
  await sidebar(page).getByRole("link", { name: "Página modelo" }).click();
  await expect(
    page.getByRole("heading", { name: "Atendimento Loja Centro", level: 1 }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="page-canvas"]')).toBeVisible();

  // Number cards, with the cents of the amount set apart.
  await expect(page.getByTestId("example-stats")).toContainText("1.284");
  await expect(page.getByTestId("example-stats")).toContainText(",60");

  // The card accordion opens one item at a time.
  const messages = page.getByTestId("example-messages");
  await expect(messages.getByText("Respondidas")).toBeVisible();
  await messages.getByRole("button", { name: /Boas-vindas/ }).click();
  await expect(
    messages.getByRole("button", { name: /Por que escolher a loja/ }),
  ).toHaveAttribute("aria-expanded", "false");

  await expect(page.getByTestId("example-leads")).toContainText("Ana Ribeiro");

  // Period filter and segmented tabs.
  const period = page.getByRole("radiogroup", { name: "Período" });
  await period.getByRole("radio", { name: "7 dias" }).click();
  await expect(period.getByRole("radio", { name: "7 dias" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("tab", { name: "Público" }).click();
  await expect(page.getByText("Nada por aqui ainda")).toBeVisible();
});
