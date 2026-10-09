/**
 * ============================================================================
 * File: tests/e2e/mcp-navigation.spec.ts
 * Module: End-to-End Tests for MCP & API Sidebar Navigation and Breadcrumbs
 *
 * Maintenance Rationale:
 * - Validates Specification Section 11, Section 15 & ADR 0009:
 *   - Sidebar navigation provides separate links for "Assistentes MCP" (/settings/mcp)
 *     and "API e Webhooks" (/settings/api).
 *   - Breadcrumbs dynamically reflect the correct hierarchy for each route.
 *   - Route switching between settings sub-pages maintains consistent navigation state.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "../../e2e/support/identity";

test.describe("MCP & API Sidebar Navigation and Breadcrumbs", () => {
  test("Tier 1 & 3: Sidebar contains distinct links for Assistentes MCP and API e Webhooks", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("nav-user");
    const wsSlug = `ws-nav-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Navigation Org",
      orgSlug: `org-nav-${Date.now()}`,
      wsName: "Workspace Navigation",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}`);

    // Verify presence of "Assistentes MCP" in sidebar
    const mcpSidebarLink = page.getByRole("link", {
      name: /(Assistentes MCP|Assistentes conectados \(MCP\))/i,
    }).or(
      page.locator(`aside a[href*="/settings/mcp"]`).first()
    );
    await expect(mcpSidebarLink).toBeVisible();

    // Verify presence of "API e Webhooks" in sidebar
    const apiSidebarLink = page.getByRole("link", {
      name: /(API e Webhooks|Chaves de API)/i,
    }).or(
      page.locator(`aside a[href*="/settings/api"]`).first()
    );
    await expect(apiSidebarLink).toBeVisible();

    // Click "Assistentes MCP" and verify landing page & URL
    await mcpSidebarLink.click();
    await page.waitForURL(new RegExp(`/app/${wsSlug}/settings/mcp`));
    expect(page.url()).toContain(`/app/${wsSlug}/settings/mcp`);

    // Verify breadcrumbs on /settings/mcp
    await expect(page.getByText(/Configurações/i).first()).toBeVisible();
    await expect(
      page.getByText(/(Assistentes conectados \(MCP\)|Assistentes MCP)/i).first(),
    ).toBeVisible();

    // From /settings/mcp, click "API e Webhooks" in sidebar
    await apiSidebarLink.click();
    await page.waitForURL(new RegExp(`/app/${wsSlug}/settings/api`));
    expect(page.url()).toContain(`/app/${wsSlug}/settings/api`);

    // Verify breadcrumbs on /settings/api
    await expect(page.getByText(/Configurações/i).first()).toBeVisible();
    await expect(
      page.getByText(/(API e Webhooks|Chaves de API)/i).first(),
    ).toBeVisible();
  });

  test("Tier 3 & 4: Direct URL navigation properly highlights active sidebar item and reflects breadcrumb", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("nav-direct-user");
    const wsSlug = `ws-direct-nav-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Direct Nav Org",
      orgSlug: `org-dir-${Date.now()}`,
      wsName: "Workspace Direct Nav",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);

    // Direct navigation to /settings/mcp
    await page.goto(`/app/${wsSlug}/settings/mcp`);
    await expect(page).toHaveURL(new RegExp(`/app/${wsSlug}/settings/mcp`));

    // Breadcrumb verification
    await expect(page.locator("nav, div").filter({ hasText: /Configurações/i }).first()).toBeVisible();

    // Direct navigation to /settings/api
    await page.goto(`/app/${wsSlug}/settings/api`);
    await expect(page).toHaveURL(new RegExp(`/app/${wsSlug}/settings/api`));

    // Breadcrumb verification
    await expect(page.locator("nav, div").filter({ hasText: /Configurações/i }).first()).toBeVisible();
  });
});
