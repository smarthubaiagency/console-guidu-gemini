/**
 * ============================================================================
 * File: e2e/credentials-and-api-keys.spec.ts
 * Module: End-to-End Tests for BYOK Credential Vault & Platform API Keys
 *
 * Maintenance Rationale:
 * - Validates Specification Section 16 & ADR 0009:
 *   - BYOK credentials stored in vault and displayed with masked values.
 *   - Platform API keys created with high-entropy token, shown once,
 *     and verifiable by hash.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test.describe("BYOK Vault and Platform API Keys Management", () => {
  test("registers a BYOK credential and verifies masked storage in vault", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("byok-admin");
    const wsSlug = `ws-byok-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "AI Solutions Org",
      orgSlug: `org-ai-${Date.now()}`,
      wsName: "Workspace AI",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/credentials`);

    // Verify page title
    await expect(page.getByRole("heading", { name: "Credenciais de Provedores de IA (BYOK)" })).toBeVisible();

    // Open registration modal
    await page.getByRole("button", { name: "Nova Credencial" }).click();

    // Fill form
    await page.getByPlaceholder("Ex: Chave de Produção 2026").fill("OpenAI Produção E2E");
    await page.getByPlaceholder("Insira a chave do OpenAI").fill("sk-proj-test-valid-e2e-key-1234567890");
    await page.getByRole("button", { name: "Salvar no Cofre" }).click();

    // Verify credential appears in table with masked value
    await expect(page.getByText("OpenAI Produção E2E")).toBeVisible();
    await expect(page.getByText("sk-...7890")).toBeVisible();
  });

  test("generates a platform API key and presents one-time secret token", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("api-admin");
    const wsSlug = `ws-api-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Platform Corp",
      orgSlug: `org-plat-${Date.now()}`,
      wsName: "Workspace Platform",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/api`);

    // Verify API keys page
    await expect(page.getByRole("heading", { name: "Chaves de API e Tokens MCP" })).toBeVisible();

    // Open creation modal
    await page.getByRole("button", { name: "Emitir Nova Chave" }).click();

    // Fill label
    await page.getByPlaceholder("Ex: Conector Cursor / Claude Code").fill("Chave E2E de Teste");
    await page.getByRole("button", { name: "Emitir Chave" }).click();

    // Verify one-time secret display modal and raw key prefix
    await expect(page.getByText("Chave de API emitida com sucesso")).toBeVisible();
    await expect(page.getByText(/gdu_live_/)).toBeVisible();

    // Verify key is listed in active table
    await expect(page.getByText("Chave E2E de Teste")).toBeVisible();
  });

  test("restricts viewer from registering credentials and issuing API keys", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("viewer-user");
    const wsSlug = `ws-viewer-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Viewer Company",
      orgSlug: `org-viewer-${Date.now()}`,
      wsName: "Workspace Viewer",
      wsSlug,
      role: "viewer",
    });

    await signIn(page, email);

    // Verify credentials page: heading is visible, but "Nova Credencial" button is not visible
    await page.goto(`/app/${wsSlug}/settings/credentials`);
    await expect(page.getByRole("heading", { name: "Credenciais de Provedores de IA (BYOK)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova Credencial" })).not.toBeVisible();

    // Verify api keys page: heading is visible, but "Emitir Nova Chave" button is not visible
    await page.goto(`/app/${wsSlug}/settings/api`);
    await expect(page.getByRole("heading", { name: "Chaves de API e Tokens MCP" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Emitir Nova Chave" })).not.toBeVisible();
  });
});

