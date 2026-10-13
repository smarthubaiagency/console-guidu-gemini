/**
 * ============================================================================
 * File: e2e/partner-ai.spec.ts
 * Module: End-to-End Tests for the AI screens of /admin (A3b)
 *
 * Maintenance Rationale:
 * - With the module flag off (default), the screens answer 404.
 * - With GUIDU_MODULE_AI_AGENTS_ENABLED, a partner owner adds an admin key,
 *   gives its GUIDU Assistant a model with that key and turns it on, and
 *   creates and publishes a GUIDS template of its own.
 * - A3c: the partner finds a customer's GUIDS, changes it and adds a
 *   referral; the customer sees "Alterado por <parceiro> em <data>".
 * ============================================================================
 */

import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test,
} from "@playwright/test";

import {
  createIdentity,
  seedGuid,
  seedPartner,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { expandSidebarGroup } from "./support/sidebar";
import { totpCode } from "./support/totp";

const enabled = process.env.GUIDU_MODULE_AI_AGENTS_ENABLED === "true";

async function partnerOwner(
  browser: Browser,
  request: APIRequestContext,
  prefix: string,
  options: { organizationId?: string; stamp?: string } = {},
): Promise<Page> {
  const stamp = options.stamp ?? Date.now().toString(36);
  const host = `${prefix}-${stamp}.localhost`;
  const email = uniqueEmail(prefix);
  await createIdentity(request, email);
  await seedPartner(request, {
    slug: `${prefix}-${stamp}`,
    name: `Agência ${stamp}`,
    host,
    memberEmail: email,
    role: "partner_owner",
    ...(options.organizationId
      ? { organizationId: options.organizationId }
      : {}),
  });
  const context = await browser.newContext({
    baseURL: `http://${host}:3000`,
  });
  const page = await context.newPage();
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
  return page;
}

test("the AI screens of /admin stay hidden while the module is off", async ({
  browser,
  request,
}) => {
  test.skip(enabled, "Runs with the module flag off (default)");
  test.setTimeout(120_000);
  const page = await partnerOwner(browser, request, "parceiro-ia-off");
  await page.goto("/admin");
  await expect(
    page.locator('[data-slot="sidebar"]').getByText("Agentes de IA"),
  ).toHaveCount(0);
  const response = await page.goto("/admin/ai/assistant");
  expect(response?.status()).toBe(404);
});

test.describe("with GUIDU_MODULE_AI_AGENTS_ENABLED", () => {
  test.skip(!enabled, "Module is frozen by default (C04)");

  test("a partner owner sets up its Assistant and a template of its own", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const page = await partnerOwner(browser, request, "parceiro-ia");
    const sidebar = page.locator('[data-slot="sidebar"]');

    await page.goto("/admin");
    await expandSidebarGroup(page, "Agentes de IA");
    await sidebar.getByRole("link", { name: "Chaves de IA" }).click();
    const register = page.getByTestId("register-key");
    await register.getByLabel("Provedor").selectOption("openrouter");
    await register.getByLabel("Nome").fill("Chave do Assistente");
    await register
      .getByLabel("Chave", { exact: true })
      .fill("sk-or-v1-0123456789abcdef0123456789");
    await register.getByRole("button", { name: "Cadastrar chave" }).click();
    await expect(page.getByText("Chave cadastrada.")).toBeVisible();
    await expect(page.getByTestId("partner-key")).toContainText(
      "Chave do Assistente",
    );

    await sidebar.getByRole("link", { name: "Assistente GUIDU" }).click();
    await expect(page.getByTestId("assistant-state")).toContainText("Rascunho");
    await expect(page.getByTestId("assistant-missing")).toBeVisible();
    const form = page.getByTestId("assistant-form");
    // Only the overview and the model connection are the partner's.
    await expect(form.getByRole("tab")).toHaveText([
      "Visão geral",
      "Conexão de modelo",
    ]);
    await form.getByLabel("Nome do agente").fill("Ajudante");
    await form.getByRole("tab", { name: "Conexão de modelo" }).click();
    await form.getByLabel("Chave", { exact: true }).selectOption({ index: 1 });
    await form.getByLabel("Modelo", { exact: true }).fill("openai/gpt-4o-mini");
    await form.getByLabel("Assistente ativo").click();
    await page.getByTestId("save-assistant").click();
    await expect(page.getByText("Assistente salvo e ativo.")).toBeVisible();
    await expect(page.getByTestId("assistant-state")).toContainText("Ativo");
    await expect(page.getByTestId("assistant-missing")).toHaveCount(0);

    await sidebar.getByRole("link", { name: "Modelos de agente" }).click();
    await expect(page.getByTestId("partner-ai-templates")).toBeVisible();
    await page.getByRole("link", { name: "Novo modelo" }).click();
    const create = page.getByTestId("create-template");
    await create.getByLabel("Nome do modelo").fill("Recepção da clínica");
    await create.getByRole("button", { name: "Criar modelo" }).click();
    const editor = page.getByTestId("template-editor");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Nome do agente").fill("Clara");
    await editor
      .getByLabel(
        "Publicado (aparece para os seus clientes na criação de GUIDS)",
      )
      .click();
    await page.getByTestId("save-template").click();
    await expect(page.getByText("Modelo salvo (versão 2).")).toBeVisible();
    await expect(
      page
        .getByTestId("template-row")
        .filter({ hasText: "Recepção da clínica" }),
    ).toContainText("Publicado");
  });

  test("a partner changes a customer's GUIDS and the customer sees it", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const stamp = Date.now().toString(36);
    const customerEmail = uniqueEmail("cliente-guids");
    await createIdentity(request, customerEmail);
    const workspace = await seedWorkspace(request, {
      email: customerEmail,
      orgName: "Clínica Sorriso",
      orgSlug: `clinica-${stamp}`,
      wsName: "Clínica Sorriso",
      wsSlug: `clinica-${stamp}`,
    });
    await seedGuid(request, { ...workspace, agentName: "Sofia" });
    const page = await partnerOwner(browser, request, "parceiro-guids", {
      organizationId: workspace.organizationId,
      stamp,
    });
    const sidebar = page.locator('[data-slot="sidebar"]');

    await page.goto("/admin");
    await expandSidebarGroup(page, "Agentes de IA");
    await sidebar.getByRole("link", { name: "GUIDS dos clientes" }).click();
    const row = page.getByTestId("guid-row").filter({ hasText: "Sofia" });
    await expect(row).toContainText("Clínica Sorriso");
    await expect(row).toContainText("Rascunho");

    // The search narrows the list; clearing it brings the GUIDS back.
    const filters = page.getByTestId("guid-filters");
    await filters.getByLabel("Buscar").fill("inexistente");
    await filters.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByText("Nenhum GUIDS encontrado.")).toBeVisible();
    await filters.getByRole("link", { name: "Limpar" }).click();
    await row.getByRole("link", { name: "Sofia" }).click();

    const form = page.getByTestId("guid-form");
    await form.getByLabel("Nome do agente").fill("Sofia da clínica");
    await page.getByTestId("save-guid").click();
    await expect(page.getByText("GUIDS salvo.")).toBeVisible();
    await expect(
      page.getByTestId("guid-row").filter({ hasText: "Sofia da clínica" }),
    ).toContainText("Alterado por vocês");

    const referral = page.getByTestId("create-referral");
    await referral.getByLabel("Nome").fill("Dra. Ana");
    await referral.getByLabel("Tag").fill("dra-ana");
    await referral.getByLabel("Especialidades").fill("Ortodontia, Implantes");
    await referral.getByLabel("Telefone").fill("+5511999998888");
    await referral.getByRole("button", { name: "Adicionar indicação" }).click();
    await expect(page.getByText("Indicação adicionada.")).toBeVisible();
    await expect(page.getByTestId("guid-referral")).toContainText(
      "Ortodontia, Implantes",
    );

    // The customer, on the partner's host, sees who changed its agent.
    const context = await browser.newContext({
      baseURL: `http://parceiro-guids-${stamp}.localhost:3000`,
    });
    const customer = await context.newPage();
    await signIn(customer, customerEmail);
    await customer.goto(`/app/clinica-${stamp}/ai-agents`);
    await expect(customer.getByTestId("workspace-guid")).toContainText(
      `Alterado por Agência ${stamp} em`,
    );
  });
});
