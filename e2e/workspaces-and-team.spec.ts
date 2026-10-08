/**
 * ============================================================================
 * File: e2e/workspaces-and-team.spec.ts
 * Module: End-to-End Tests for Workspace Navigation, Team & Invitations
 *
 * Maintenance Rationale:
 * - Validates Specification Section 11 & Section 14:
 *   - Landing router at `/app` redirects single-workspace members directly to `/app/[workspaceSlug]`.
 *   - Workspace dashboard displays operational modules.
 *   - Team management page lists active members and handles expirable invitations.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test.describe("Workspace Navigation and Team Management", () => {
  test("redirects single-workspace member from /app directly to workspace shell", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("ws-nav");
    const wsSlug = `ws-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Empresa Inovadora",
      orgSlug: `org-${Date.now()}`,
      wsName: "Ambiente Principal",
      wsSlug,
    });

    await signIn(page, email);
    // Directly redirects to workspace shell
    await expect(page).toHaveURL(new RegExp(`/app/${wsSlug}$`));
    await expect(page.getByRole("heading", { name: "Ambiente Principal" })).toBeVisible();
  });

  test("displays team members and creates an expirable invitation", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("team-admin");
    const wsSlug = `ws-team-${Date.now()}`;
    await createIdentity(request, email);
    await seedWorkspace(request, {
      email,
      orgName: "Equipe Alpha",
      orgSlug: `org-team-${Date.now()}`,
      wsName: "Workspace Time",
      wsSlug,
      role: "owner",
    });

    await signIn(page, email);
    await page.goto(`/app/${wsSlug}/settings/team`);

    // Verify team page title and active members list
    await expect(page.getByRole("heading", { name: "Equipe e Permissões de Acesso" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // Open invite member modal
    await page.getByRole("button", { name: "Convidar Membro" }).click();

    // Fill invitation form
    const invitedEmail = uniqueEmail("invitee");
    await page.getByPlaceholder("usuario@empresa.com").fill(invitedEmail);
    await page.getByRole("button", { name: "Gerar Convite" }).click();

    // Verify feedback and pending invitations table contains the invited email
    await expect(page.getByText(invitedEmail)).toBeVisible();
  });
});
