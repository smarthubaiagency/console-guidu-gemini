/**
 * ============================================================================
 * File: e2e/crm.spec.ts
 * Module: End-to-End Tests for the CRM module, contacts (F4c)
 *
 * Maintenance Rationale:
 * - Plano F4, decisão 3: the owner enables the CRM in Configurações ›
 *   Módulos, adds a contact, edits it and finds it by search.
 * - Before the module is enabled the route shows the disabled state.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { expandSidebarGroup, sidebar } from "./support/sidebar";

test("owner enables the CRM, adds, edits and finds a contact", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("crm-owner");
  const wsSlug = `crm-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `CRM ${stamp}`,
    orgSlug: `crm-org-${stamp}`,
    wsName: `Workspace CRM ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);

  await page.goto(`/app/${wsSlug}/crm/contacts`);
  await expect(
    page.getByRole("heading", { name: "Módulo desabilitado" }),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar CRM" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}`);
  await expandSidebarGroup(page, "CRM");
  await sidebar(page).getByRole("link", { name: "Contatos" }).click();
  await expect(page.getByRole("heading", { name: "Contatos" })).toBeVisible();

  const create = page.getByTestId("create-contact");
  await create.getByLabel("Nome").fill("Maria E2E");
  await create.getByLabel("E-mail").fill("maria@e2e.test");
  await create.getByLabel("Empresa").fill("Cliente E2E");
  await create.getByRole("button", { name: "Adicionar contato" }).click();
  await expect(
    create.getByRole("status").filter({ hasText: /Contato/ }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("link", { name: "Maria E2E" }).click();
  const edit = page.getByTestId("edit-contact");
  await edit.getByLabel("Telefone").fill("11 98888-7777");
  await edit.getByLabel("Cargo").fill("Compras");
  await edit.getByRole("button", { name: "Salvar contato" }).click();
  await expect(
    edit.getByRole("status").filter({ hasText: /Contato/ }),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}/crm/contacts`);
  await page.getByLabel("Buscar contatos").fill("cliente e2e");
  await page.getByRole("button", { name: "Buscar" }).click();
  const list = page.getByTestId("crm-contact-list");
  await expect(list.getByRole("link", { name: "Maria E2E" })).toBeVisible();
  await expect(list).toContainText("11 98888-7777");

  await page.getByLabel("Buscar contatos").fill("ninguem");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Nenhum contato encontrado.")).toBeVisible();
});
