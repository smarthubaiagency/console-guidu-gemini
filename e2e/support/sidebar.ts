import { expect, type Page } from "@playwright/test";

/** The shadcn sidebar-08 of the shell (ADR 0014), desktop or mobile. */
export const sidebar = (page: Page) => page.locator('[data-slot="sidebar"]');

/** Opens a menu entry that groups sub-entries (closed unless active). */
export async function expandSidebarGroup(page: Page, group: string) {
  await sidebar(page)
    .getByRole("button", { name: `Abrir ou fechar ${group}` })
    .click();
}

/** Signs out through the account menu at the bottom of the sidebar. */
export async function signOutFromShell(page: Page) {
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByTestId("user-menu").click();
  await page.getByTestId("sign-out").click();
}
