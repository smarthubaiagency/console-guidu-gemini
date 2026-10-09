/**
 * ============================================================================
 * File: e2e/ai-agents.spec.ts
 * Module: End-to-End Tests for AI Agents Module Governance & Freezing (C04)
 *
 * Maintenance Rationale:
 * - Validates freezing controls (ADR 0003 & C04):
 *   - When disabled (default), direct route shows "Módulo Indisponível" and sidebar
 *     omits the "Agentes de IA" navigation item.
 *   - When enabled explicitly in test rig, interactive creation flow works.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test.describe("AI Agents Module (Freezing and Availability Controls)", () => {
  test("shows 'Indisponível' on direct route and hides sidebar item when module is disabled (default)", async ({
    page,
    request,
  }) => {
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

    // Verify chat prompt input is not rendered
    await expect(
      page.getByPlaceholder("Digite uma mensagem para o agente de IA..."),
    ).toHaveCount(0);
  });

  test.describe("when GUIDU_MODULE_AI_AGENTS_ENABLED is enabled", () => {
    test.skip(
      process.env.GUIDU_MODULE_AI_AGENTS_ENABLED !== "true",
      "Module is frozen by default (C04); runs only when GUIDU_MODULE_AI_AGENTS_ENABLED is true",
    );

    test("renders AI agent interface and registers a new persona", async ({
      page,
      request,
    }) => {
      const email = uniqueEmail("agent-tester");
      const wsSlug = `ws-agent-${Date.now()}`;
      await createIdentity(request, email);
      await seedWorkspace(request, {
        email,
        orgName: "AI Enterprise",
        orgSlug: `org-ai-ent-${Date.now()}`,
        wsName: "Workspace Agents",
        wsSlug,
        role: "owner",
      });

      await signIn(page, email);
      await page.goto(`/app/${wsSlug}/ai-agents`);

      // Verify page title
      await expect(
        page.getByRole("heading", { name: "Agentes de Inteligência Artificial & Motor de Prompts" }),
      ).toBeVisible();

      // Verify chat prompt input is available
      await expect(
        page.getByPlaceholder("Digite uma mensagem para o agente de IA..."),
      ).toBeVisible();

      // Open create agent modal
      await page.getByRole("button", { name: "Novo" }).click();
      await expect(
        page.getByRole("heading", { name: "Cadastrar Persona do Agente" }),
      ).toBeVisible();

      // Fill new agent form
      await page.getByPlaceholder("Ex: Suporte N2 ou Especialista em Redação").fill("Agente Especialista E2E");
      await page.getByPlaceholder("Instruções e diretrizes de comportamento do agente...").fill("Você é um assistente E2E especializado.");
      await page.getByRole("button", { name: "Criar Agente" }).click();

      // Verify newly registered agent feedback and appears in the selector
      await expect(page.getByText(/criado com sucesso/)).toBeVisible();
      await expect(page.locator("select")).toContainText("Agente Especialista E2E (openai)");
    });
  });
});
