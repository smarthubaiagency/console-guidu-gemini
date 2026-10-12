/**
 * ============================================================================
 * File: e2e/design-components.spec.ts
 * Module: End-to-End Tests for the components catalogue (U3a, ADR 0014)
 *
 * Maintenance Rationale:
 * - Plataforma › Configurações › Padrões de interface › Componentes shows
 *   the shadcn components every screen uses; the interactive ones (select,
 *   switch, tabs) work and the form kit labels its fields.
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

test("the components catalogue shows the shadcn components working", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail("components");
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
  await sidebar(page).getByRole("link", { name: "Componentes" }).click();
  await expect(
    page.getByRole("heading", { name: "Componentes", level: 1 }),
  ).toBeVisible();

  // Fields are reachable by their labels.
  await page.getByLabel("Nome").fill("Maria E2E");
  await expect(page.getByLabel("Nome")).toHaveValue("Maria E2E");
  await page.getByLabel("Plano (NativeSelect)").selectOption("scale");
  await expect(page.getByLabel("Plano (NativeSelect)")).toHaveValue("scale");

  // The rich select opens a list and takes the choice.
  await page.getByLabel("Plano (Select)").click();
  await page.getByRole("option", { name: "Scale" }).click();
  await expect(page.getByLabel("Plano (Select)")).toContainText("Scale");

  // Switch and tabs respond.
  const toggle = page.getByRole("switch", { name: "Notificações ativas" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("tab", { name: "Configurações" }).click();
  await expect(page.getByText("Conteúdo da aba Configurações.")).toBeVisible();

  await expect(page.getByTestId("components-table")).toContainText(
    "Maria Souza",
  );
});
