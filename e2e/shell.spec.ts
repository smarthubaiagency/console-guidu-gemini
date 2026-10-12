/**
 * ============================================================================
 * File: e2e/shell.spec.ts
 * Module: End-to-End Tests for the standard shell (U1, ADR 0014)
 *
 * Maintenance Rationale:
 * - The customer dashboard uses the shadcn sidebar-08 shell: active entry,
 *   breadcrumb, collapse kept across reloads by the `sidebar_state` cookie,
 *   workspace switcher, theme and logout in the account menu, and the drawer
 *   on a phone-sized screen.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { sidebar, signOutFromShell } from "./support/sidebar";

async function seedTwoWorkspaces(
  request: Parameters<typeof createIdentity>[0],
  prefix: string,
) {
  const email = uniqueEmail(prefix);
  const stamp = Date.now();
  await createIdentity(request, email);
  for (const [name, slug] of [
    ["Shell Um", `shell-um-${stamp}`],
    ["Shell Dois", `shell-dois-${stamp}`],
  ] as const) {
    await seedWorkspace(request, {
      email,
      orgName: "Empresa Shell",
      orgSlug: `org-${slug}`,
      wsName: name,
      wsSlug: slug,
      role: "owner",
    });
  }
  return { email, first: `shell-um-${stamp}`, second: `shell-dois-${stamp}` };
}

test("the customer shell navigates, collapses, switches and signs out", async ({
  page,
  request,
}) => {
  const { email, first, second } = await seedTwoWorkspaces(request, "shell");
  await signIn(page, email);
  await page.goto(`/app/${first}/settings/team`);

  // Active entry and breadcrumb come from the generated navigation.
  const menu = sidebar(page);
  await expect(menu).toHaveAttribute("data-state", "expanded");
  await expect(
    menu.getByRole("link", { name: "Equipe & Membros" }),
  ).toHaveAttribute("aria-current", "page");
  const trail = page.getByRole("navigation", { name: "Caminho da página" });
  await expect(trail).toContainText("Configurações");
  await expect(trail).toContainText("Equipe & Membros");
  await expect(page.getByTestId("user-identity")).toHaveText(email);

  // Collapse survives a reload (cookie read on the server).
  await page.getByTestId("sidebar-trigger").click();
  await expect(menu).toHaveAttribute("data-state", "collapsed");
  await page.reload();
  await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed");
  await page.getByTestId("sidebar-trigger").click();
  await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");

  // Workspace switcher at the top of the sidebar.
  await page.getByTestId("workspace-switcher").click();
  await page.getByRole("menuitem", { name: /Shell Dois/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${second}$`));
  await expect(page.getByTestId("workspace-switcher")).toContainText(
    "Shell Dois",
  );

  // Theme in the account menu.
  await page.getByTestId("user-menu").click();
  await page.getByTestId("theme-toggle").click();
  const theme = await page.locator("html").getAttribute("data-theme");
  expect(theme === "dark" || theme === "light").toBe(true);

  await signOutFromShell(page);
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
});

test("on a phone the sidebar opens as a drawer", async ({ page, request }) => {
  const { email, first } = await seedTwoWorkspaces(request, "shell-mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, email);
  await page.goto(`/app/${first}`);

  await expect(sidebar(page)).toHaveCount(0);
  await page.getByTestId("sidebar-trigger").click();
  const drawer = sidebar(page);
  await expect(drawer).toHaveAttribute("data-mobile", "true");
  await drawer.getByRole("link", { name: "Equipe & Membros" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${first}/settings/team$`));
});
