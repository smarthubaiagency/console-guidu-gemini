/**
 * ============================================================================
 * File: e2e/status.spec.ts
 * Module: End-to-End Tests for the SmartStatusBanner (S1, ADR 0016)
 *
 * Maintenance Rationale:
 * - Plataforma › Configurações › Padrões de interface › Avisos shows every
 *   kind of message: the banner sits under the 60px header, closes by
 *   itself, pauses on click and resumes, keeps a confirmation until it is
 *   answered (checkbox first), and Esc closes it before a drawer.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { expandSidebarGroup, sidebar } from "./support/sidebar";
import { totpCode } from "./support/totp";

async function platformAdmin(
  page: Page,
  request: Parameters<typeof createIdentity>[0],
) {
  const email = uniqueEmail("status");
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();
}

test("the banner shows results, pauses, resumes and asks for confirmation", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await platformAdmin(page, request);
  await page.goto("/platform");
  await expandSidebarGroup(page, "Padrões de interface");
  await sidebar(page).getByRole("link", { name: "Avisos" }).click();
  await expect(page.getByRole("heading", { name: "Avisos" })).toBeVisible();

  const banner = page.getByTestId("smart-status");

  // A result sits right under the header and closes by itself.
  await page.getByTestId("status-demo-up").click();
  await expect(banner).toHaveAttribute("data-type", "up");
  await expect(banner).toHaveAttribute("role", "status");
  await expect(banner).toContainText("Contato salvo!");
  const header = await page.locator('[data-slot="shell-header"]').boundingBox();
  const card = await banner.boundingBox();
  expect(card!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(card!.y).toBeLessThan(header!.y + header!.height + 24);
  await expect(banner).toBeHidden({ timeout: 8_000 });

  // A click pauses it; it stays until resumed or closed.
  await page.getByTestId("status-demo-oops").click();
  await banner.click();
  await expect(banner).toContainText("Pausado. Clique × para fechar.");
  await expect(page.getByTestId("smart-status-countdown")).toHaveAttribute(
    "data-paused",
    "true",
  );
  await page.waitForTimeout(4_500);
  await expect(banner).toBeVisible();
  await page.getByTestId("smart-status-resume").click();
  await expect(banner).toBeHidden({ timeout: 8_000 });

  // An error: role alert, details behind the chevron with the buttons.
  await page.getByTestId("status-demo-down").click();
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("smart-status-action")).toHaveCount(0);
  await banner.getByRole("button", { name: "Ver detalhes" }).click();
  await expect(banner).toContainText("o e-mail já pertence a outro contato");
  await page.getByTestId("smart-status-close").click();
  await expect(banner).toBeHidden();

  // A confirmation waits for the checkbox and survives other notices.
  await page.getByTestId("status-demo-confirm").click();
  await expect(banner).toHaveAttribute("role", "alertdialog");
  const unlink = page.getByTestId("smart-status-action");
  await expect(unlink).toBeDisabled();
  await page.getByTestId("status-demo-up").click({ force: true });
  await expect(banner).toContainText("Desvincular cartão?");
  await banner.getByRole("checkbox").click();
  await unlink.click();
  await expect(page.getByTestId("status-answer")).toContainText("confirmou");
  await expect(banner).toContainText("Cartão desvinculado");

  // Esc answers "cancel".
  await page.getByTestId("status-demo-destructive").click();
  await expect(banner).toContainText("Cancelar o addon?");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("status-answer")).toContainText("cancelou");
  await expect(banner).toBeHidden();
});
