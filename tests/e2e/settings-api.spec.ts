/**
 * ============================================================================
 * File: tests/e2e/settings-api.spec.ts
 * Module: End-to-End Tests for the API & Webhooks page
 *
 * Maintenance Rationale:
 * - Validates Specification Section 11, Section 15 & ADR 0009:
 *   - /settings/api documents the REST API v1 (F4a): base URL, workspace id,
 *     routes with their scopes and limits; webhooks are "Em breve".
 *   - No fake charts, dummy metrics, or synthetic telemetry graphs.
 *   - Includes an informational link directing users to /settings/mcp for AI assistant connections.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "../../e2e/support/identity";

test.describe("API & Webhooks (/settings/api)", () => {
  test("Tier 1 & 4: Documents the API v1 without dummy metrics", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("api-ph4-user");
    const wsSlug = `ws-api-ph4-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "API Placeholder Org",
      orgSlug: `org-api-${Date.now()}`,
      wsName: "Workspace API Placeholder",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/api`);

    // Verify page heading and breadcrumbs
    await expect(
      page.getByRole("heading", {
        name: /(Chaves de API & Webhooks|API e Webhooks|Chaves de API)/i,
      }),
    ).toBeVisible();

    await expect(page.getByText(/Configurações/i).first()).toBeVisible();
    await expect(
      page.getByText(/(API e Webhooks|Chaves de API)/i).first(),
    ).toBeVisible();

    // The API v1 routes are documented; webhooks are announced (F4a).
    await expect(page.getByTestId("api-routes")).toContainText(
      "GET /workspaces/{id}",
    );
    await expect(
      page.getByText(/Em breve: avisos da plataforma/i),
    ).toBeVisible();

    // Verify STRICT ABSENCE of dummy metrics / fake charts (Specification Section 11 & AGENTS.md)
    // There should be NO synthetic request counters, fake uptime percentages, or mock charts.
    await expect(
      page.locator(
        "canvas, svg.recharts-surface, .recharts-responsive-container",
      ),
    ).toHaveCount(0);
    await expect(
      page.getByText(/99\.9% uptime|12,450 requisições|Taxa de Sucesso: 100%/i),
    ).not.toBeVisible();
  });

  test("Tier 1 & 3: Provides informational link directing developers to /settings/mcp", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("api-mcp-link");
    const wsSlug = `ws-api-link-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "MCP Link Org",
      orgSlug: `org-link-${Date.now()}`,
      wsName: "Workspace MCP Link",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/api`);

    // Verify presence of informational link to /settings/mcp
    const mcpLink = page
      .getByRole("link", {
        name: /(Assistentes MCP|Assistentes conectados|Configurar assistentes MCP|Ir para MCP)/i,
      })
      .first();

    await expect(mcpLink).toBeVisible();

    // Click link and verify navigation to /settings/mcp
    await mcpLink.click();
    await page.waitForURL(new RegExp(`/app/${wsSlug}/settings/mcp`));
    expect(page.url()).toContain(`/app/${wsSlug}/settings/mcp`);

    // Heading for MCP assistants must be present
    await expect(
      page.getByRole("heading", {
        name: /(Assistentes conectados \(MCP\)|Tokens de API & Autenticação MCP|Assistentes MCP)/i,
      }),
    ).toBeVisible();
  });

  test("Tier 2: Accessible to both workspace owner and viewer without permission denial", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("api-viewer");
    const wsSlug = `ws-api-viewer-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "API Viewer Org",
      orgSlug: `org-view-api-${Date.now()}`,
      wsName: "Workspace API Viewer",
      wsSlug,
      role: "viewer",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/api`);

    // Viewer can view the developer page without 403 or error
    await expect(page.getByTestId("api-routes")).toBeVisible();
    await expect(
      page.getByText(/Acesso Negado|PermissionDenied/i),
    ).not.toBeVisible();
  });
});
