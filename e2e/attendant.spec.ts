/**
 * ============================================================================
 * File: e2e/attendant.spec.ts
 * Module: End-to-End Tests for the workspace role Atendente (AT1)
 *
 * Maintenance Rationale:
 * - Decision of 16/10/2026 (especificação do Inbox §3): the Attendant enters
 *   only the dashboard and the Inbox (IN4). Until the Inbox exists it sees
 *   the dashboard alone; every other area answers 404 on the server, not
 *   only a hidden menu, and the workspace API answers 403.
 * - The rig database runs as superuser, so this proves the UI and the server
 *   guards; RLS is proven by tests/core/attendant-rls.sql in CI.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { sidebar } from "./support/sidebar";
import { statusBanner } from "./support/status";

test("the Attendant sees only the dashboard and gets 404 elsewhere", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const owner = uniqueEmail("at1-owner");
  const attendant = uniqueEmail("at1-attendant");
  const wsSlug = `at1-${stamp}`;
  const orgName = `AT1 ${stamp}`;
  for (const email of [owner, attendant]) await createIdentity(request, email);
  await seedWorkspace(request, {
    email: owner,
    orgName,
    orgSlug: `at1-org-${stamp}`,
    wsName: `Workspace AT1 ${stamp}`,
    wsSlug,
    role: "owner",
  });
  const { workspaceId } = await seedWorkspace(request, {
    email: attendant,
    orgName,
    orgSlug: `at1-org-${stamp}`,
    wsName: `Workspace AT1 ${stamp}`,
    wsSlug,
    role: "attendant",
    orgRole: "member",
  });

  // The owner turns the CRM on, so a 404 below comes from the role alone.
  await signIn(page, owner);
  await page.goto(`/app/${wsSlug}/settings/modules`);
  await page.getByRole("button", { name: "Habilitar CRM" }).click();
  await expect(
    statusBanner(page).filter({ hasText: "Módulo habilitado." }),
  ).toBeVisible();
  await page.context().clearCookies();

  await signIn(page, attendant);
  const dashboard = await page.goto(`/app/${wsSlug}`);
  expect(dashboard?.status()).toBe(200);
  await expect(page.getByTestId("attendant-dashboard")).toBeVisible();
  await expect(
    sidebar(page).getByRole("link", { name: "Visão Geral" }),
  ).toBeVisible();
  for (const entry of ["Configurações", "Execuções", "CRM"]) {
    await expect(sidebar(page).getByText(entry, { exact: true })).toHaveCount(
      0,
    );
  }
  // Nothing on the dashboard leads to the team or the settings.
  await expect(
    page.getByRole("link", { name: "Gerenciar Equipe" }),
  ).toHaveCount(0);

  for (const path of [
    "settings",
    "settings/general",
    "settings/team",
    "crm/contacts",
    "executions",
  ]) {
    const response = await page.goto(`/app/${wsSlug}/${path}`);
    expect(response?.status(), path).toBe(404);
  }

  // The workspace API answers 403 to the session; the own list still works.
  const mine = await page.request.get("/api/v1/me/workspaces");
  expect(mine.status()).toBe(200);
  expect(
    (await mine.json()).data.find((w: { slug: string }) => w.slug === wsSlug),
  ).toMatchObject({ role: "attendant" });
  for (const path of ["modules", "members", "overview"]) {
    const response = await page.request.get(
      `/api/v1/workspaces/${workspaceId}/${path}`,
    );
    expect(response.status(), path).toBe(403);
  }
});
