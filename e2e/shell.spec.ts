/**
 * ============================================================================
 * File: e2e/shell.spec.ts
 * Module: End-to-End Tests for the standard shell (U1, ADR 0014)
 *
 * Maintenance Rationale:
 * - The customer dashboard uses the shadcn sidebar-08 shell: active entry,
 *   breadcrumb, collapse kept across reloads by the `sidebar_state` cookie,
 *   workspace switcher, logout in the account menu, the 60px header (search,
 *   colour mode, assistant drawer, console shortcuts only when allowed) and
 *   the drawer on a phone-sized screen.
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

  // 60px header with a bottom border.
  const header = page.locator('[data-slot="shell-header"]');
  expect((await header.boundingBox())?.height).toBe(60);
  await expect(header).toHaveCSS("border-bottom-width", "1px");

  // Search opens with Ctrl+K and goes to a page of the navigation.
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Pesquisar páginas…").fill("Equipe");
  await page.getByRole("option", { name: "Equipe & Membros" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${second}/settings/team$`));

  // Colour mode in the header.
  const before = await page.locator("html").getAttribute("data-theme");
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-theme",
    before ?? "",
  );

  // The assistant opens in the internal drawer and closes with Esc.
  await page.getByTestId("assistant-toggle").click();
  const assistant = page.getByRole("complementary", {
    name: "Assistente de IA",
  });
  await expect(assistant).toBeVisible();
  // The drawer takes the focus once mounted; Esc before that is a race.
  await expect(assistant).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(assistant).toBeHidden();

  // A customer without a console role sees no console shortcuts.
  await expect(page.getByTestId("admin-link")).toHaveCount(0);
  await expect(page.getByTestId("platform-link")).toHaveCount(0);

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
