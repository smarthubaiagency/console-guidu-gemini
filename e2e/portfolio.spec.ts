/**
 * ============================================================================
 * File: e2e/portfolio.spec.ts
 * Module: End-to-End Tests for the Portfolio module (F5a)
 *
 * Maintenance Rationale:
 * - The owner enables the Portfolio, registers a store (UCP Location) in
 *   Configurações › Lojas, creates a product with price and SKU, activates
 *   it at the store, adds a second variant and sees the UCP preview.
 * - Lodging (F5c): a property, an accommodation type with capacity, house
 *   rules, a non-refundable rate plan and its nightly price, in the UCP
 *   lodging shapes.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { sidebar } from "./support/sidebar";

test("owner registers a store and a product with variants in the Portfolio", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("portfolio-owner");
  const wsSlug = `port-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Portfólio ${stamp}`,
    orgSlug: `port-org-${stamp}`,
    wsName: `Workspace Portfólio ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);

  await page.goto(`/app/${wsSlug}/portfolio`);
  await expect(
    page.getByRole("heading", { name: "Módulo desabilitado" }),
  ).toBeVisible();
  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Portfólio" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();

  // Store in the workspace settings.
  await page.goto(`/app/${wsSlug}`);
  await sidebar(page).getByRole("link", { name: "Lojas" }).click();
  const store = page.getByTestId("create-location");
  await store.getByLabel("Nome da loja").fill("Loja Centro E2E");
  await store.getByLabel("Cidade").fill("São Paulo");
  await store.getByLabel("UF").fill("SP");
  await store.getByLabel("Segunda abre").fill("09:00");
  await store.getByLabel("Segunda fecha").fill("18:00");
  await store.getByLabel("Estacionamento").check();
  await store.getByRole("button", { name: "Cadastrar loja" }).click();
  await expect(
    page.getByRole("heading", { name: "Loja Centro E2E" }),
  ).toBeVisible();

  // Product.
  await sidebar(page).getByRole("link", { name: "Portfólio" }).click();
  await page.getByRole("link", { name: "Novo item" }).click();
  const create = page.getByTestId("create-portfolio-item");
  await create.getByLabel("Título").fill("Camiseta E2E");
  await create.getByLabel("Descrição").fill("Algodão 100%.");
  await create.getByLabel("SKU").fill(`CAM-${stamp}`);
  await create.getByLabel("Preço (R$)").fill("49,90");
  await create.getByRole("button", { name: "Criar item" }).click();
  await expect(
    page.getByRole("heading", { name: "Camiseta E2E" }),
  ).toBeVisible();

  const edit = page.getByTestId("edit-portfolio-item");
  await edit.getByLabel("Situação").selectOption("active");
  await edit.getByLabel("No local / retirada").check();
  await edit.getByLabel("Loja Centro E2E").check();
  await edit.getByRole("button", { name: "Salvar item" }).click();
  await expect(
    edit.getByRole("status").filter({ hasText: "Item salvo." }),
  ).toBeVisible();

  const add = page.getByTestId("add-variant");
  await add.getByLabel("Nome da variante").fill("Preta");
  await add.getByLabel("Preço (R$)").fill("54,90");
  await add.getByRole("button", { name: "Adicionar variante" }).click();
  await expect(page.getByTestId("variant")).toHaveCount(2);

  const preview = page.getByTestId("ucp-preview");
  await expect(preview).toContainText("agentes compatíveis com o UCP");
  await expect(preview).toContainText('"price_range"');
  await expect(preview).toContainText(`CAM-${stamp}`);
  await expect(preview).not.toContainText("ai_keywords");

  await page.goto(`/app/${wsSlug}/portfolio`);
  const list = page.getByTestId("portfolio-list");
  await expect(list.getByRole("link", { name: "Camiseta E2E" })).toBeVisible();
  await expect(list).toContainText("a partir de R$ 49,90");
  await expect(list).toContainText("2 variantes");

  // A healthcare service (F5b): the vertical fields come from its schema.
  await page.getByRole("link", { name: "Novo item" }).click();
  const service = page.getByTestId("create-portfolio-item");
  await service.getByLabel("Categoria").selectOption("service:healthcare");
  await service.getByLabel("Título").fill("Consulta E2E");
  await service.getByLabel("Preço (R$)").fill("250,00");
  await service.getByRole("button", { name: "Criar item" }).click();
  await expect(
    page.getByRole("heading", { name: "Consulta E2E" }),
  ).toBeVisible();
  const details = page.getByTestId("details-fields");
  await details.getByLabel("Duração (minutos)").fill("50");
  await details.getByLabel("Conselho profissional").selectOption("cro");
  await details.getByLabel("Número do registro").fill("12345");
  await details.getByLabel("Convênios aceitos").fill("Amil, Bradesco Saúde");
  const serviceEdit = page.getByTestId("edit-portfolio-item");
  await serviceEdit.getByLabel("Situação").selectOption("active");
  await serviceEdit.getByRole("button", { name: "Salvar item" }).click();
  await expect(
    serviceEdit.getByRole("status").filter({ hasText: "Item salvo." }),
  ).toBeVisible();
  await expect(page.getByTestId("ucp-preview")).toContainText(
    "co.guidu.portfolio.service.healthcare",
  );
  await expect(page.getByTestId("ucp-preview")).toContainText("Bradesco Saúde");
});

test("owner registers lodging with accommodation, rate plans and nightly prices", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("lodging-owner");
  const wsSlug = `lodg-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Hospedagem ${stamp}`,
    orgSlug: `lodg-org-${stamp}`,
    wsName: `Workspace Hospedagem ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);

  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Portfólio" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}/settings/locations`);
  const store = page.getByTestId("create-location");
  await store.getByLabel("Nome da loja").fill("Prédio Praia E2E");
  await store.getByLabel("Cidade").fill("Ubatuba");
  await store.getByLabel("UF").fill("SP");
  await store.getByRole("button", { name: "Cadastrar loja" }).click();
  await expect(
    page.getByRole("heading", { name: "Prédio Praia E2E" }),
  ).toBeVisible();

  await page.goto(`/app/${wsSlug}/portfolio`);
  await page.getByRole("link", { name: "Novo item" }).click();
  const create = page.getByTestId("create-portfolio-item");
  await create.getByLabel("Categoria").selectOption("lodging:general");
  await create.getByLabel("Título").fill("Pousada E2E");
  await create.getByLabel("Preço (R$)").fill("450,00");
  await create.getByRole("button", { name: "Criar item" }).click();
  await expect(
    page.getByRole("heading", { name: "Pousada E2E" }),
  ).toBeVisible();

  // The default accommodation gets its name and capacity.
  const type = page.getByTestId("accommodation-type").first();
  await type.getByLabel("Nome da acomodação").fill("Suíte casal E2E");
  await type.getByLabel("Tipo de espaço").selectOption("suite");
  await type.getByLabel("Capacidade total").fill("3");
  await type.getByLabel("Máximo de adultos").fill("2");
  await type.getByRole("button", { name: "Salvar acomodação" }).click();
  await expect(
    type.getByRole("status").filter({ hasText: "Acomodação salva." }),
  ).toBeVisible();

  // House rules, property and activation.
  const edit = page.getByTestId("edit-portfolio-item");
  const details = page.getByTestId("details-fields");
  await details.getByLabel("Check-in a partir de").fill("14:00");
  await details.getByLabel("Check-out até").fill("11:00");
  await details.getByLabel("Aceita animais").check();
  await details.getByLabel("Taxa de limpeza (R$)").fill("150,00");
  await edit.getByLabel("Prédio Praia E2E").check();
  await edit.getByLabel("Situação").selectOption("active");
  await edit.getByRole("button", { name: "Salvar item" }).click();
  await expect(
    edit.getByRole("status").filter({ hasText: "Item salvo." }),
  ).toBeVisible();

  // A non-refundable plan with its own nightly price.
  const plan = page.getByTestId("add-rate-plan");
  await plan.getByLabel("Nome da tarifa").fill("Não reembolsável E2E");
  await plan
    .locator('select[name="refundability"]')
    .selectOption("non_refundable");
  await plan.getByLabel("Alimentação").selectOption("breakfast");
  await plan.getByRole("button", { name: "Adicionar tarifa" }).click();
  await expect(page.getByTestId("rate-plan")).toHaveCount(2);

  const price = page.getByTestId("add-variant");
  await price.getByLabel("Tarifa").selectOption({
    label: "Não reembolsável E2E",
  });
  await price.getByLabel("Nome da variante").fill("Suíte sem reembolso");
  await price.getByLabel("Preço da diária (R$)").fill("380,00");
  await price.getByRole("button", { name: "Adicionar variante" }).click();
  await expect(page.getByTestId("variant")).toHaveCount(2);

  const preview = page.getByTestId("ucp-preview");
  await expect(preview).toContainText("agentes compatíveis com o UCP");
  await expect(preview).toContainText("co.guidu.portfolio.lodging");
  await expect(preview).toContainText("dev.ucp.lodging.policy.cancellation");
  await expect(preview).toContainText('"non_refundable"');
  await expect(preview).toContainText("Suíte casal E2E");
  await expect(preview).toContainText("Prédio Praia E2E");
  await expect(preview).toContainText('"night"');
});
