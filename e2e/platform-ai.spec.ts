/**
 * ============================================================================
 * File: e2e/platform-ai.spec.ts
 * Module: End-to-End Tests for the AI screens of /platform (A3a)
 *
 * Maintenance Rationale:
 * - With the module flag off (default), the screens answer 404 and the
 *   sidebar has no "IA".
 * - With GUIDU_MODULE_AI_AGENTS_ENABLED, a platform owner opens IA (CF6a):
 *   the dashboard, the providers and models (saved as they are), creates a
 *   GUIDS template, fills the five tabs in the drawer, sees an invalid
 *   field next to it, saves and publishes it; and saves the backup model.
 * ============================================================================
 */

import { expect, type Page, test } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { totpCode } from "./support/totp";

async function platformOwnerWithMfa(
  page: Page,
  request: Parameters<typeof createIdentity>[0],
  prefix: string,
) {
  const email = uniqueEmail(prefix);
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

const enabled = process.env.GUIDU_MODULE_AI_AGENTS_ENABLED === "true";

test("the AI screens of /platform stay hidden while the module is off", async ({
  page,
  request,
}) => {
  test.skip(enabled, "Runs with the module flag off (default)");
  test.setTimeout(120_000);
  await platformOwnerWithMfa(page, request, "platform-ai-off");
  await page.goto("/platform");
  await expect(
    page
      .locator('[data-slot="sidebar"]')
      .getByRole("link", { name: "IA", exact: true }),
  ).toHaveCount(0);
  const response = await page.goto("/platform/ai/templates");
  expect(response?.status()).toBe(404);
  expect((await page.goto("/platform/ai"))?.status()).toBe(404);
});

test.describe("with GUIDU_MODULE_AI_AGENTS_ENABLED", () => {
  test.skip(!enabled, "Module is frozen by default (C04)");

  test("a platform owner edits and publishes a house template and the backup", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await platformOwnerWithMfa(page, request, "platform-ai");

    await page.goto("/platform");
    const sidebar = page.locator('[data-slot="sidebar"]');
    await sidebar.getByRole("link", { name: "IA", exact: true }).click();
    await expect(page.getByTestId("platform-ai")).toBeVisible();
    await expect(page.getByTestId("ai-by-provider")).toContainText("OpenAI");
    await expect(page.getByTestId("ai-card-providers")).toBeVisible();
    const tabs = page.getByTestId("ai-tabs");
    await page.getByRole("link", { name: "Últimos 7 dias" }).click();
    await expect(page).toHaveURL(/days=7/);

    // Providers and models (CF6a): saved as they are, so nothing changes
    // for the other tests.
    await tabs.getByRole("link", { name: "Provedores e modelos" }).click();
    const providers = page.getByTestId("ai-providers-form");
    await expect(providers.getByTestId("provider-switch-openai")).toBeChecked();
    await expect(providers.getByLabel("Modelos de OpenRouter")).toHaveValue(
      /openai\/gpt-4o-mini/,
    );
    await page.getByTestId("ai-providers-save").click();
    await expect(page.getByText("Provedores e modelos salvos.")).toBeVisible();

    await tabs.getByRole("link", { name: "Modelos de agente" }).click();
    await expect(page.getByTestId("platform-ai-templates")).toBeVisible();
    // The seeds: the Assistant's template and Anna.
    const list = page.getByTestId("template-list");
    await expect(
      list.getByRole("link", { name: "Assistente GUIDU" }),
    ).toBeVisible();
    await expect(list.getByRole("link", { name: "Anna (SDR)" })).toBeVisible();

    const name = `Agendador ${Date.now()}`;
    await page.getByRole("link", { name: "Novo modelo" }).click();
    const create = page.getByTestId("create-template");
    await create.getByLabel("Nome do modelo").fill(name);
    await create.getByLabel("Segmento").fill("Serviços");
    await create.getByRole("button", { name: "Criar modelo" }).click();

    const editor = page.getByTestId("template-editor");
    await expect(editor).toBeVisible();
    await expect(page).toHaveURL(/\?edit=/);
    await editor.getByLabel("Nome do agente").fill("Bia");
    await editor.getByLabel("Idioma").selectOption("pt-BR");
    await editor.getByLabel("Prompt do sistema").fill("Você é {{agent_name}}.");

    await editor.getByRole("tab", { name: "Escopo" }).click();
    await editor.getByLabel("Fuso horário").fill("America/Sao_Paulo");
    await editor.getByRole("button", { name: "Adicionar horário" }).click();

    await editor.getByRole("tab", { name: "Regras" }).click();
    await editor
      .getByLabel("Transferência para humano")
      .selectOption("always_ask");
    // Hot below warm: refused, with the message next to the field.
    await editor.getByLabel("Lead quente a partir de").fill("10");
    await editor.getByLabel("Lead morno a partir de").fill("20");
    await editor.getByRole("button", { name: "Adicionar regra" }).click();
    await editor.getByLabel("Nome da regra").fill("Quer agendar");
    await editor
      .getByLabel("Sinal que o agente procura")
      .fill("Pede um horário");

    await editor.getByRole("tab", { name: "Integração" }).click();
    await editor.getByLabel("Transferir para humano").check();

    await page.getByTestId("save-template").click();
    await expect(page.getByText("Revise os campos destacados.")).toBeVisible();
    await editor.getByRole("tab", { name: "Regras" }).click();
    await expect(
      editor.getByText(
        "O limiar de lead quente deve ser maior que o de morno.",
      ),
    ).toBeVisible();

    await editor.getByLabel("Lead quente a partir de").fill("60");
    await editor
      .getByLabel("Publicado (aparece para os clientes na criação de GUIDS)")
      .click();
    await page.getByTestId("save-template").click();
    await expect(page.getByText("Modelo salvo (versão 2).")).toBeVisible();

    const row = list.getByTestId("template-row").filter({ hasText: name });
    await expect(row.getByText("Publicado")).toBeVisible();
    await expect(row.getByText("Versão 2")).toBeVisible();

    // Backup of the platform: the model, without a key yet.
    // The drawer covers the tabs: back to IA through the sidebar.
    await sidebar.getByRole("link", { name: "IA", exact: true }).click();
    await expect(page.getByTestId("platform-ai")).toBeVisible();
    await page
      .getByTestId("ai-tabs")
      .getByRole("link", { name: "Chave reserva" })
      .click();
    const backup = page.getByTestId("backup-form");
    await backup.getByLabel("Modelo barato").fill("gpt-4o-mini");
    await backup.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Chave reserva salva.")).toBeVisible();
    await expect(page.getByTestId("backup-current")).toContainText(
      "modelo gpt-4o-mini",
    );
    await expect(page.getByTestId("backup-off")).toBeVisible();
  });
});
