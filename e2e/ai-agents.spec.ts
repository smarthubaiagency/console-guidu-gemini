/**
 * ============================================================================
 * File: e2e/ai-agents.spec.ts
 * Module: End-to-End Tests for AI Agents Module Governance & Freezing (C04)
 *
 * Maintenance Rationale:
 * - Validates freezing controls (ADR 0003 & C04):
 *   - When disabled (default), direct route shows "Módulo Indisponível" and sidebar
 *     omits the "Agentes de IA" navigation item.
 *   - When enabled explicitly in test rig (A4a), the owner creates a GUIDS
 *     from a template, customizes it, renames it, adds a referral and
 *     deletes it.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedGuid,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";

test.describe("AI Agents Module (Freezing and Availability Controls)", () => {
  test("shows 'Indisponível' on direct route and hides sidebar item when module is disabled (default)", async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.GUIDU_MODULE_AI_AGENTS_ENABLED === "true",
      "Runs with the module flag off (default)",
    );
    const email = uniqueEmail("agent-disabled");
    const wsSlug = `ws-agent-off-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "AI Frozen Org",
      orgSlug: `org-ai-off-${Date.now()}`,
      wsName: "Workspace Frozen",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}`);

    // Verify sidebar does NOT display "Agentes de IA"
    const aiAgentsLink = page.getByRole("link", { name: /Agentes de IA/i });
    await expect(aiAgentsLink).toHaveCount(0);

    // Direct navigation to /app/${wsSlug}/ai-agents renders unavailable UI
    await page.goto(`/app/${wsSlug}/ai-agents`);
    await expect(
      page.getByRole("heading", { name: "Módulo Indisponível" }),
    ).toBeVisible();
  });

  test.describe("when GUIDU_MODULE_AI_AGENTS_ENABLED is enabled", () => {
    test.skip(
      process.env.GUIDU_MODULE_AI_AGENTS_ENABLED !== "true",
      "Module is frozen by default (C04); runs only when GUIDU_MODULE_AI_AGENTS_ENABLED is true",
    );

    test("the owner creates, customizes, tests and deletes a GUIDS", async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      const email = uniqueEmail("agent-tester");
      const wsSlug = `ws-agent-${Date.now()}`;
      await createIdentity(request, email);
      const workspace = await seedWorkspace(request, {
        email,
        orgName: "AI Enterprise",
        orgSlug: `org-ai-ent-${Date.now()}`,
        wsName: "Workspace Agents",
        wsSlug,
        role: "owner",
      });
      await seedGuid(request, workspace);

      await signIn(page, email);
      await page.goto(`/app/${wsSlug}/ai-agents`);
      await expect(page.getByTestId("guid-quota")).toContainText("0 de 1");
      await page.getByRole("link", { name: "Novo agente" }).click();
      const create = page.getByTestId("create-guid");
      await create.getByRole("radio", { name: /Anna/ }).check();
      await create.getByRole("button", { name: "Criar agente" }).click();

      const panel = page.getByTestId("guid-panel");
      await expect(panel.getByTestId("guid-state")).toContainText("Rascunho");
      await expect(panel.getByTestId("guid-missing")).toBeVisible();
      // Following the template, the customer has the business and the model.
      await expect(page.getByTestId("guid-form").getByRole("tab")).toHaveText([
        "Visão geral",
        "Conexão de modelo",
      ]);
      await expect(panel.getByTestId("guid-tested")).toContainText(
        "ainda não foi testada",
      );
      await expect(page.getByRole("link", { name: "Novo agente" })).toHaveCount(
        0,
      );

      await page.getByTestId("customize-guid").click();
      const question = statusBanner(page);
      await question.getByRole("checkbox").check();
      await question.getByTestId("smart-status-action").click();
      await expect(statusBanner(page)).toContainText("Agente personalizado.");

      const form = page.getByTestId("guid-form");
      await form.getByRole("tab", { name: "Visão geral" }).click();
      await form.getByLabel("Nome do agente").fill("Clara");
      await page.getByTestId("save-guid").click();
      await expect(statusBanner(page)).toContainText("Agente salvo.");
      await expect(page.getByTestId("workspace-guid")).toContainText("Clara");

      const referral = page.getByTestId("create-referral");
      await referral.getByLabel("Nome").fill("Dra. Ana");
      await referral.getByLabel("Tag").fill("dra-ana");
      await referral
        .getByRole("button", { name: "Adicionar indicação" })
        .click();
      await expect(statusBanner(page)).toContainText("Indicação adicionada.");
      await expect(page.getByTestId("guid-referral")).toContainText("Dra. Ana");

      // "Testar agente": the chat in the drawer.
      await page.getByTestId("open-guid-test").click();
      const chat = page.getByTestId("guid-test");
      await expect(chat).toBeVisible();
      await page.getByTestId("guid-test-input").fill("Olá, vocês atendem?");
      await page.getByTestId("guid-test-send").click();
      await expect(chat.getByTestId("guid-test-user")).toContainText(
        "Olá, vocês atendem?",
      );
      // The worker answers, or the screen says it is answering.
      await expect(
        chat
          .getByTestId("guid-test-waiting")
          .or(chat.getByTestId("guid-test-agent")),
      ).toBeVisible();
      await chat.getByRole("link", { name: "Voltar à configuração" }).click();
      await expect(page.getByTestId("guid-panel")).toBeVisible();

      await page.getByTestId("delete-guid").click();
      const remove = statusBanner(page);
      await remove.getByRole("checkbox").check();
      await remove.getByTestId("smart-status-action").click();
      await expect(page.getByTestId("workspace-guid")).toHaveCount(0);
      await expect(page.getByTestId("guid-quota")).toContainText("0 de 1");
    });
  });
});
