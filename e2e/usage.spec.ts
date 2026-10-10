/**
 * ============================================================================
 * File: e2e/usage.spec.ts
 * Module: End-to-End Tests for "Consumo & Limites" (F3b)
 *
 * Maintenance Rationale:
 * - A company without subscription (legacy) sees its real usage: members
 *   against seats and hello-world records against the module's default
 *   limit, both measured on the server.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test("usage shows measured counts against the limits", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("usage-owner");
  const wsSlug = `ws-usage-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `Usage Org ${Date.now()}`,
    orgSlug: `usage-org-${Date.now()}`,
    wsName: "Usage Workspace",
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);

  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar Hello World" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();
  await page.goto(`/app/${wsSlug}/hello-world/records`);
  await page.getByLabel("Título do registro").fill("Contado no consumo");
  await page.getByRole("button", { name: "Criar registro" }).click();
  await expect(page.getByRole("status")).toContainText("Registro criado.");

  await page.goto(`/app/${wsSlug}/settings/usage`);
  await expect(page.getByTestId("usage-plan")).toContainText("legado");
  await expect(
    page.getByTestId("usage-core.seats").getByTestId("usage-value"),
  ).toHaveText("1 / 10");
  await expect(
    page.getByTestId("usage-hello-world.records").getByTestId("usage-value"),
  ).toHaveText("1 / 10");
});
