/**
 * ============================================================================
 * File: e2e/invite.spec.ts
 * Module: End-to-End Tests for Invitation Flow & Recipient Binding
 *
 * Maintenance Rationale:
 * - Validates Specification Section 8, Section 10, Section 11 & Section 18:
 *   - Route `/invite/[token]` requires authentication and preserves `next` parameter.
 *   - Valid recipient accepting invitation transitions to target workspace.
 *   - Recipient mismatch prevents acceptance and displays explicit error.
 *   - Expired invitations display expiration message without accept action.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  seedInvitation,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test.describe("Invitation Flow and Recipient Binding", () => {
  test("redirects unauthenticated visitor to /login preserving next parameter", async ({
    page,
  }) => {
    const rawToken = "mock-unauthenticated-token-12345";
    await page.goto(`/invite/${rawToken}`);

    // Must redirect to /login with next=/invite/<token>
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/invite/${rawToken}`)}`);
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  });

  test("accepts invitation with matching recipient and redirects to workspace", async ({
    page,
    request,
  }) => {
    const ownerEmail = uniqueEmail("owner-invite");
    const wsSlug = `ws-inv-${Date.now()}`;
    await createIdentity(request, ownerEmail);
    const { organizationId, workspaceId } = await seedWorkspace(request, {
      email: ownerEmail,
      orgName: "Organizacao Convite",
      orgSlug: `org-inv-${Date.now()}`,
      wsName: "Workspace Convite",
      wsSlug,
      role: "owner",
    });

    const inviteeEmail = uniqueEmail("invitee-match");
    await createIdentity(request, inviteeEmail);

    const { rawToken } = await seedInvitation(request, {
      organizationId,
      workspaceId,
      email: inviteeEmail,
      role: "member",
    });

    // Sign in as the invited user
    await signIn(page, inviteeEmail);

    // Access the invite link
    await page.goto(`/invite/${rawToken}`);

    // Verify invite details page
    await expect(page.getByRole("heading", { name: "Convite de equipe" })).toBeVisible();
    await expect(page.getByText("Organizacao Convite")).toBeVisible();
    await expect(page.getByText("Workspace Convite")).toBeVisible();

    // Click "Aceitar Convite"
    const acceptButton = page.getByRole("button", { name: "Aceitar Convite" });
    await expect(acceptButton).toBeVisible();
    await acceptButton.click();

    // Should redirect to workspace shell
    await expect(page).toHaveURL(new RegExp(`/app/${wsSlug}$`));
    await expect(page.getByRole("heading", { name: "Workspace Convite" })).toBeVisible();
  });

  test("displays recipient mismatch error when signed in with a different user", async ({
    page,
    request,
  }) => {
    const ownerEmail = uniqueEmail("owner-mismatch");
    const wsSlug = `ws-mis-${Date.now()}`;
    await createIdentity(request, ownerEmail);
    const { organizationId, workspaceId } = await seedWorkspace(request, {
      email: ownerEmail,
      orgName: "Organizacao Mismatch",
      orgSlug: `org-mis-${Date.now()}`,
      wsName: "Workspace Mismatch",
      wsSlug,
      role: "owner",
    });

    const intendedInvitee = uniqueEmail("intended-recipient");
    const wrongUserEmail = uniqueEmail("wrong-user");
    await createIdentity(request, wrongUserEmail);

    const { rawToken } = await seedInvitation(request, {
      organizationId,
      workspaceId,
      email: intendedInvitee,
      role: "member",
    });

    // Sign in with the wrong user account
    await signIn(page, wrongUserEmail);

    // Navigate to the invite token
    await page.goto(`/invite/${rawToken}`);

    // Verify recipient mismatch notice
    await expect(page.getByRole("heading", { name: "Destinatário diferente" })).toBeVisible();
    await expect(page.getByTestId("invite-mismatch")).toContainText(
      "Este convite foi enviado para outro e-mail.",
    );

    // Accept button should not exist
    await expect(page.getByRole("button", { name: "Aceitar Convite" })).not.toBeVisible();
  });

  test("displays expired state when invitation is past expiration", async ({
    page,
    request,
  }) => {
    const ownerEmail = uniqueEmail("owner-expired");
    const wsSlug = `ws-exp-${Date.now()}`;
    await createIdentity(request, ownerEmail);
    const { organizationId, workspaceId } = await seedWorkspace(request, {
      email: ownerEmail,
      orgName: "Organizacao Expirada",
      orgSlug: `org-exp-${Date.now()}`,
      wsName: "Workspace Expirado",
      wsSlug,
      role: "owner",
    });

    const inviteeEmail = uniqueEmail("invitee-expired");
    await createIdentity(request, inviteeEmail);

    // Seed an invitation that expired 24 hours ago
    const { rawToken } = await seedInvitation(request, {
      organizationId,
      workspaceId,
      email: inviteeEmail,
      role: "member",
      expiresInHours: -24,
    });

    // Sign in as the invited user
    await signIn(page, inviteeEmail);

    // Navigate to the invite token
    await page.goto(`/invite/${rawToken}`);

    // Verify expired notice
    await expect(page.getByRole("heading", { name: "Convite expirado" })).toBeVisible();
    await expect(page.getByTestId("invite-expired")).toContainText(
      "Este convite expirou. Peça ao administrador para enviar um novo convite.",
    );

    // Accept button should not exist
    await expect(page.getByRole("button", { name: "Aceitar Convite" })).not.toBeVisible();
  });
});
