/**
 * ============================================================================
 * File: e2e/platform-console.spec.ts
 * Module: End-to-End Tests for the Platform Console (/platform)
 *
 * Maintenance Rationale:
 * - Validates Specification Section 7 & Section 12:
 *   - Enforces AAL2 MFA and platform_admin_members membership for /platform.
 *   - Displays consolidated operational metrics and tenant management pages.
 *   - Denies non-admin accounts access via server guard.
 * - ADR 0012: the console moved from /admin to /platform; /admin stays free
 *   for the partner console and answers 404 until then.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";
import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { totpCode } from "./support/totp";

test.describe("Platform Administration Governance Console", () => {
  test("allows platform administrator with verified MFA to access admin overview and subpages", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("superadmin");
    await createIdentity(request, email);
    await makePlatformAdmin(request, email);

    await signIn(page, email);

    // Enrol TOTP MFA
    await page.goto("/app/account/security");
    await page.getByTestId("start-mfa-enrolment").click();
    const secret = (
      await page.getByTestId("totp-secret").textContent()
    )?.trim();
    expect(secret).toBeTruthy();

    await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
    await page.getByRole("button", { name: "Confirmar ativação" }).click();
    await expect(page.getByTestId("mfa-factors")).toBeVisible();

    // Access platform administration overview
    await page.goto("/platform");
    await expect(
      page.getByRole("heading", { name: "Visão Geral Operacional" }),
    ).toBeVisible();
    await expect(page.getByText("Empresas / Clientes Ativos")).toBeVisible();
    await expect(page.getByText("Workspaces Ativos")).toBeVisible();

    // Access customers management subpage
    await page.goto("/platform/customers");
    await expect(
      page.getByRole("heading", { name: "Empresas Contratantes" }),
    ).toBeVisible();

    // Access workspaces management subpage
    await page.goto("/platform/workspaces");
    await expect(
      page.getByRole("heading", { name: "Workspaces da Plataforma" }),
    ).toBeVisible();

    // Access users management subpage
    await page.goto("/platform/users");
    await expect(
      page.getByRole("heading", { name: "Usuários da Plataforma" }),
    ).toBeVisible();
  });

  test("denies access to regular user with MFA who is not a platform admin", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("regular-user");
    await createIdentity(request, email);
    // Not calling makePlatformAdmin!

    await signIn(page, email);

    // Enrol TOTP
    await page.goto("/app/account/security");
    await page.getByTestId("start-mfa-enrolment").click();
    const secret = (
      await page.getByTestId("totp-secret").textContent()
    )?.trim();
    expect(secret).toBeTruthy();

    await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
    await page.getByRole("button", { name: "Confirmar ativação" }).click();
    await expect(page.getByTestId("mfa-factors")).toBeVisible();

    // Attempt to access /platform -> redirected to /auth/denied
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/auth\/denied$/);
  });

  test("answers 404 on the former /admin route", async ({ request }) => {
    const response = await request.get("/admin", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  });
});
