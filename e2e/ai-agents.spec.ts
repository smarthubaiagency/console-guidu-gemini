/**
 * ============================================================================
 * File: e2e/ai-agents.spec.ts
 * Module: End-to-End Tests for AI Agents & Resilient Prompt Interface
 *
 * Maintenance Rationale:
 * - Validates Specification Section 16 & Task 07:
 *   - Persona switching and configuration creation.
 *   - Chat interface structure, prompt input and session listing.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test.describe("AI Agents and Prompt Interface", () => {
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
