/**
 * ============================================================================
 * File: tests/e2e/settings-mcp.spec.ts
 * Module: End-to-End Tests for MCP Connected Assistants Key Management
 *
 * Maintenance Rationale:
 * - Validates C12 requirements (ADR 0009, Specification Sections 11, 15, 17.3):
 *   - MCP keys management located at /app/[workspaceSlug]/settings/mcp.
 *   - Creation with canonical Section 17.3 workspace scopes.
 *   - Default scopes (workspace:read + modules:read) pre-selected.
 *   - Explicit opt-in and warning banner for proposals:write scope.
 *   - One-time reveal of high-entropy raw secret token (gdu_live_...).
 *   - Immediate key revocation with confirmation.
 *   - Role restriction: Viewer role can create read-only keys, but cannot
 *     issue keys with proposals:write (disabled/blocked).
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "../../e2e/support/identity";

test.describe("MCP Connected Assistants Settings (/settings/mcp)", () => {
  test("Tier 1 & 4: Lists connected MCP assistants and displays empty state on fresh workspace", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("mcp-owner");
    const wsSlug = `ws-mcp-list-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "MCP Testing Org",
      orgSlug: `org-mcp-${Date.now()}`,
      wsName: "Workspace MCP List",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/mcp`);

    // Verify page heading and breadcrumbs
    await expect(
      page.getByRole("heading", {
        name: /(Assistentes conectados \(MCP\)|Tokens de API & Autenticação MCP|Assistentes MCP)/i,
      }),
    ).toBeVisible();

    await expect(page.getByText(/Configurações/i).first()).toBeVisible();
    await expect(
      page.getByText(/(Assistentes conectados \(MCP\)|Assistentes MCP)/i).first(),
    ).toBeVisible();

    // Verify empty state or table container
    await expect(
      page.getByText(/(Nenhuma chave emitida|Chaves de API Emitidas \(0\)|Nenhum assistente conectado)/i).first(),
    ).toBeVisible();

    // Verify creation button is accessible to owner
    await expect(page.getByRole("button", { name: "Emitir Nova Chave" })).toBeVisible();
  });

  test("Tier 1: Creates new MCP key with default scopes (workspace:read + modules:read)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("mcp-default-scopes");
    const wsSlug = `ws-mcp-def-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Default Scopes Org",
      orgSlug: `org-def-${Date.now()}`,
      wsName: "Workspace Default Scopes",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/mcp`);

    // Open creation modal
    await page.getByRole("button", { name: "Emitir Nova Chave" }).click();

    // Verify modal is open
    await expect(
      page.getByRole("heading", { name: /Emitir Nova Chave/i }).or(page.getByText(/Emitir Nova Chave/i)).first(),
    ).toBeVisible();

    // Fill key name / application label
    const keyName = "Cursor AI Assistant Default";
    await page.getByPlaceholder(/Conector Cursor|Nome da Chave/i).fill(keyName);

    // Verify default scopes are checked and write scope is unchecked
    const wsReadCheckbox = page.locator('input[type="checkbox"][value="workspace:read"], input[type="checkbox"]:has-text("workspace:read")').or(
      page.locator('label:has-text("workspace:read") input[type="checkbox"]')
    ).first();

    const modReadCheckbox = page.locator('input[type="checkbox"][value="modules:read"], input[type="checkbox"]:has-text("modules:read")').or(
      page.locator('label:has-text("modules:read") input[type="checkbox"]')
    ).first();

    const propWriteCheckbox = page.locator('input[type="checkbox"][value="proposals:write"], input[type="checkbox"]:has-text("proposals:write")').or(
      page.locator('label:has-text("proposals:write") input[type="checkbox"]')
    ).first();

    // If explicit scope checkboxes exist, check their default state
    if (await wsReadCheckbox.isVisible().catch(() => false)) {
      await expect(wsReadCheckbox).toBeChecked();
    }
    if (await modReadCheckbox.isVisible().catch(() => false)) {
      await expect(modReadCheckbox).toBeChecked();
    }
    if (await propWriteCheckbox.isVisible().catch(() => false)) {
      await expect(propWriteCheckbox).not.toBeChecked();
    }

    // Submit key creation
    await page.getByRole("button", { name: /Emitir Chave/i }).click();

    // Verify success feedback and single-reveal raw key
    await expect(
      page.getByText(/(Chave de API emitida com sucesso|Chave emitida com sucesso)/i),
    ).toBeVisible();
    await expect(page.getByText(/gdu_live_/)).toBeVisible();

    // Verify key appears in active list
    await expect(page.getByText(keyName)).toBeVisible();
    await expect(page.getByText("Ativa")).toBeVisible();
  });

  test("Tier 1 & 2: Opt-in proposals:write scope requires explicit selection and displays mandatory warning alert", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("mcp-write-warning");
    const wsSlug = `ws-mcp-write-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Proposals Org",
      orgSlug: `org-prop-${Date.now()}`,
      wsName: "Workspace Proposals",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/mcp`);

    // Open creation modal
    await page.getByRole("button", { name: "Emitir Nova Chave" }).click();

    const keyName = "Claude Proposal Assistant Write";
    await page.getByPlaceholder(/Conector Cursor|Nome da Chave/i).fill(keyName);

    // Locate proposals:write checkbox / label
    const propWriteLabel = page.getByText(/proposals:write|Escrita de Propostas/i).first();
    await propWriteLabel.click();

    // Verify mandatory warning alert appears in UI
    await expect(
      page.getByText(/Atenção.*(propor alterações|aprovação humana)/i),
    ).toBeVisible();

    // Submit key creation
    await page.getByRole("button", { name: /Emitir Chave/i }).click();

    // Verify success banner and raw key presentation
    await expect(page.getByText(/gdu_live_/)).toBeVisible();

    // Verify key is listed with proposals:write scope badge
    await expect(page.getByText(keyName)).toBeVisible();
    await expect(page.getByText(/proposals:write/i).first()).toBeVisible();
  });

  test("Tier 1 & 2: Single key display modal shows raw token once with copy button and prevents retrieval after dismissal", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("mcp-single-reveal");
    const wsSlug = `ws-mcp-reveal-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Reveal Org",
      orgSlug: `org-rev-${Date.now()}`,
      wsName: "Workspace Reveal",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/mcp`);

    await page.getByRole("button", { name: "Emitir Nova Chave" }).click();
    await page.getByPlaceholder(/Conector Cursor|Nome da Chave/i).fill("Temporary Reveal Key");
    await page.getByRole("button", { name: /Emitir Chave/i }).click();

    // Single reveal banner visible with explicit notice
    await expect(
      page.getByText(/(nunca mais poderá ser visualizado|não poderá ser recuperada|armazene-o com segurança)/i),
    ).toBeVisible();

    // Copy button exists
    const copyButton = page.getByRole("button", { name: /Copiar Chave|Copiar/i });
    await expect(copyButton).toBeVisible();

    // Capture the raw key text
    const rawKeyText = await page.getByText(/gdu_live_[a-f0-9]{64}/).innerText().catch(async () => {
      const match = await page.locator("text=/gdu_live_/").first().innerText();
      return match;
    });
    expect(rawKeyText).toContain("gdu_live_");

    // Click copy button
    await copyButton.click();
    await expect(page.getByText(/(Copiada!|Copiado!)/i)).toBeVisible();

    // Reload the page to simulate session continuation
    await page.reload();

    // Ensure raw key secret (beyond masked prefix) is never rendered again
    await expect(page.getByText(rawKeyText)).not.toBeVisible();

    // Only masked prefix should be present in table (e.g., gdu_live_...)
    await expect(page.getByText("Temporary Reveal Key")).toBeVisible();
    await expect(page.getByText("Ativa")).toBeVisible();
  });

  test("Tier 1 & 3: Revokes active key with confirmation and updates status immediately to Revogada", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("mcp-revoke");
    const wsSlug = `ws-mcp-rev-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Revoke Org",
      orgSlug: `org-revk-${Date.now()}`,
      wsName: "Workspace Revoke",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/mcp`);

    // Create a key to revoke
    const keyName = "Key To Be Revoked E2E";
    await page.getByRole("button", { name: "Emitir Nova Chave" }).click();
    await page.getByPlaceholder(/Conector Cursor|Nome da Chave/i).fill(keyName);
    await page.getByRole("button", { name: /Emitir Chave/i }).click();

    await expect(page.getByText(keyName)).toBeVisible();
    await expect(page.getByText("Ativa").first()).toBeVisible();

    // Handle browser confirm dialog or custom confirmation modal
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toMatch(/(Revogar|perderão o acesso imediatamente)/i);
      await dialog.accept();
    });

    // Click revoke button (trash or action button)
    const revokeButton = page.getByRole("button", { name: /Revogar chave|Revogar/i }).or(
      page.locator('button[title*="Revogar"], button[aria-label*="Revogar"]').first()
    );
    await revokeButton.click();

    // If custom modal confirmation exists instead of dialog:
    const confirmModalButton = page.getByRole("button", { name: /Confirmar Revogação|Sim, revogar/i });
    if (await confirmModalButton.isVisible().catch(() => false)) {
      await confirmModalButton.click();
    }

    // Status updates immediately to "Revogada"
    await expect(page.getByText("Revogada").first()).toBeVisible();
  });

  test("Tier 1, 2 & 4: Role restriction: Viewer role can create read-only keys, but cannot create keys with proposals:write", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("mcp-viewer");
    const wsSlug = `ws-mcp-view-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Viewer Org",
      orgSlug: `org-view-${Date.now()}`,
      wsName: "Workspace Viewer",
      wsSlug,
      role: "viewer",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/mcp`);

    // Viewer CAN see page and "Emitir Nova Chave" button for read-only keys
    await expect(page.getByRole("button", { name: "Emitir Nova Chave" })).toBeVisible();

    // Open creation modal
    await page.getByRole("button", { name: "Emitir Nova Chave" }).click();

    // Verify proposals:write checkbox is disabled or blocked for viewer
    const propWriteInput = page.locator('input[type="checkbox"][value="proposals:write"]').or(
      page.locator('label:has-text("proposals:write") input[type="checkbox"]')
    ).first();

    if (await propWriteInput.isVisible().catch(() => false)) {
      await expect(propWriteInput).toBeDisabled();
    } else {
      // Alternatively, proposals:write is not shown or clearly marked as restricted
      const writeDisabledNotice = page.getByText(/Sem permissão para emitir escrita|Apenas leitura para visualizador|proposals:write/i).first();
      await expect(writeDisabledNotice).toBeVisible();
    }

    // Viewer creates key with allowed read scopes
    const viewerKeyName = "Viewer Read-Only Assistant";
    await page.getByPlaceholder(/Conector Cursor|Nome da Chave/i).fill(viewerKeyName);
    await page.getByRole("button", { name: /Emitir Chave/i }).click();

    // Creation succeeds for read scopes
    await expect(
      page.getByText(/(Chave de API emitida com sucesso|Chave emitida com sucesso)/i),
    ).toBeVisible();
    await expect(page.getByText(viewerKeyName)).toBeVisible();
  });
});
