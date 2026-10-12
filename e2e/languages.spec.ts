/**
 * ============================================================================
 * File: e2e/languages.spec.ts
 * Module: End-to-End Tests for the languages of the dashboard (I1)
 *
 * Maintenance Rationale:
 * - A platform owner adds a language in Plataforma › Configurações ›
 *   Idiomas, translates a text and turns the language on.
 * - The owner asks for the machine translation of the missing texts (fake
 *   provider) and finds them in the "Automáticos a revisar" filter.
 * - The person picks that language and sees the translated menu.
 * - Following the workspace again, the owner sets the workspace default to
 *   Spanish and the menu follows it.
 * - The language code is unique per run because the e2e database is shared.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  runJobs,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { totpCode } from "./support/totp";

test("languages: add, translate, choose per person and per workspace", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const code = `it-E${stamp.slice(-6)}`;
  const name = `Italiano ${stamp}`;
  const email = uniqueEmail("languages-owner");
  const wsSlug = `lang-${stamp}`;
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Idiomas ${stamp}`,
    orgSlug: `lang-org-${stamp}`,
    wsName: `Workspace Idiomas ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);

  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  // Plataforma › Configurações › Idiomas.
  await page.goto("/platform");
  await page.locator("aside").getByRole("link", { name: "Idiomas" }).click();
  const table = page.getByTestId("languages-table");
  await expect(table.getByTestId("language-pt-BR")).toContainText("100%");
  await expect(table.getByTestId("language-en")).toContainText("English");
  await expect(table.getByTestId("language-es")).toContainText("Español");

  const add = page.getByTestId("add-language");
  await add.getByLabel("Código").fill(code);
  await add.getByLabel("Nome").fill(name);
  await add.getByRole("button", { name: "Adicionar idioma" }).click();
  await expect(table.getByTestId(`language-${code}`)).toContainText("Rascunho");

  await table
    .getByTestId(`language-${code}`)
    .getByRole("link", { name: "Traduzir" })
    .click();
  await page
    .getByRole("textbox", { name: "Buscar", exact: true })
    .fill("nav.items.core_overview");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const text = page.getByTestId("language-text");
  await expect(text).toHaveCount(1);
  await expect(text).toContainText("Visão Geral");
  // Fill only once the form is hydrated: a value typed before hydration can
  // be reset to the current text and saved unchanged.
  await page.waitForLoadState("networkidle");
  const current = text.getByLabel("Texto atual");
  await expect(async () => {
    await current.fill("Panoramica E2E");
    await expect(current).toHaveValue("Panoramica E2E", { timeout: 1_000 });
  }).toPass();
  await text.getByRole("button", { name: "Salvar texto" }).click();
  await expect(
    text.getByRole("status").filter({ hasText: "Texto salvo." }),
  ).toBeVisible();

  // Machine translation (I6, fake provider in e2e): fills the texts still
  // missing, never the one just saved; they show in "Automáticos a revisar".
  const machine = page.getByTestId("machine-translation");
  await machine
    .getByRole("button", { name: "Traduzir automaticamente" })
    .click();
  await expect(
    machine
      .getByRole("status")
      .filter({ hasText: "Tradução automática pedida" }),
  ).toBeVisible();
  expect(await runJobs(request)).toBe(0);
  await page.goto(
    `/platform/settings/languages/${code}?filter=machine&q=languages.title`,
  );
  await expect(page.getByTestId("machine-translation-status")).toHaveAttribute(
    "data-status",
    "succeeded",
  );
  await expect(page.getByTestId("language-text")).toHaveCount(1);
  await expect(page.getByTestId("language-text")).toContainText(
    `[${code}]Idiomas`,
  );

  await page.goto("/platform/settings/languages");
  await table
    .getByTestId(`language-${code}`)
    .getByRole("button", { name: "Ativar" })
    .click();
  await expect(table.getByTestId(`language-${code}`)).toContainText("Ativo");

  // The person chooses the new language.
  await page.goto("/app/account/language");
  const mine = page.getByTestId("my-language");
  await mine.getByLabel("Meu idioma").selectOption({ label: name });
  await mine.getByRole("button", { name: "Idioma" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", code);

  await page.goto(`/app/${wsSlug}`);
  const menu = page.locator("aside");
  await expect(
    menu.getByRole("link", { name: "Panoramica E2E" }),
  ).toBeVisible();
  // Machine texts keep the source words (fake provider prefixes them).
  await expect(menu.getByRole("link", { name: "Execuções" })).toBeVisible();

  // Back to following the workspace; the workspace goes Spanish.
  await page.goto("/app/account/language");
  await mine.getByRole("combobox").selectOption("");
  await mine.getByRole("button").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");

  await page.goto(`/app/${wsSlug}/settings/general`);
  const wsLanguage = page.getByTestId("workspace-language");
  await wsLanguage.getByRole("combobox").selectOption("es");
  await wsLanguage.getByRole("button").click();
  await expect(
    wsLanguage
      .getByRole("status")
      .filter({ hasText: /Idioma (salvo|guardado)\./ }),
  ).toBeVisible();
  await page.goto(`/app/${wsSlug}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    menu.getByRole("link", { name: "Visión general" }),
  ).toBeVisible();
  await expect(menu).toContainText("Configuración");
});
