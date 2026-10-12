/**
 * ============================================================================
 * File: e2e/workbench.spec.ts
 * Module: End-to-End Tests for the edit and chat window (U2a, ADR 0015)
 *
 * Maintenance Rationale:
 * - Plataforma › Configurações › Padrões de interface shows the workbench:
 *   the internal drawer opens inside the content, pushes it at 350px,
 *   covers it at 700px, closes with Esc and returns the focus, and takes
 *   the whole content on a phone, where the left column becomes a drawer.
 * ============================================================================
 */

import { expect, test, type Page } from "@playwright/test";

import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { sidebar } from "./support/sidebar";
import { totpCode } from "./support/totp";

async function platformAdmin(
  page: Page,
  request: Parameters<typeof createIdentity>[0],
) {
  const email = uniqueEmail("workbench");
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

const width = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
const paddingRight = (page: Page) =>
  page
    .locator('[data-slot="workbench-main"]')
    .evaluate((el) => getComputedStyle(el).paddingRight);

test("the workbench drawer pushes, expands, closes and returns the focus", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await platformAdmin(page, request);
  // Wide enough for the 700px drawer next to the sidebar and the list.
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.goto("/platform");
  await sidebar(page)
    .getByRole("link", { name: "Padrões de interface" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Padrões de interface" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("nada é gravado");

  // Editing: the 350px drawer opens inside the content and pushes it.
  const panel = page.getByRole("complementary", { name: "Editar contato" });
  await expect(panel).toHaveCount(0);
  const edit = page
    .getByRole("row", { name: /Bruno Lima/ })
    .getByRole("button", { name: "Editar" });
  await edit.click();
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(panel.getByLabel("Nome")).toHaveValue("Bruno Lima");
  await expect
    .poll(() => width(page, '[data-slot="workbench-panel"]'))
    .toBe(350);
  await expect.poll(() => paddingRight(page)).toBe("350px");

  // The drawer stays inside the content: the sidebar is not covered.
  const box = await panel.boundingBox();
  const menu = await sidebar(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(menu!.x + menu!.width);

  // Esc closes it and the focus returns to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect.poll(() => paddingRight(page)).toBe("0px");

  // Chat: open on arrival; wide (700px) covers the content.
  await page.getByRole("link", { name: "Chat" }).click();
  const chat = page.getByRole("complementary", { name: "Assistente" });
  await expect(chat).toBeVisible();
  await expect
    .poll(() => width(page, '[data-slot="workbench-panel"]'))
    .toBe(350);
  await chat.getByTestId("workbench-resize").click();
  await expect(chat).toHaveAttribute("data-size", "wide");
  await expect
    .poll(() => width(page, '[data-slot="workbench-panel"]'))
    .toBe(700);
  await expect.poll(() => paddingRight(page)).toBe("0px");
  await chat.getByLabel("Escreva uma mensagem").fill("Teste");
  await chat.getByRole("button", { name: "Enviar" }).click();
  await expect(chat).toContainText("nada é enviado nem gravado");
  await chat.getByTestId("workbench-close").click();
  await expect(chat).toHaveCount(0);
  await page.getByTestId("workbench-open").click();
  await expect(chat).toBeVisible();
});

test("on a phone the drawer takes the content and the list opens aside", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await platformAdmin(page, request);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/platform/design/workbench?demo=simple");
  await page.getByTestId("workbench-open").click();
  const panel = page.getByRole("complementary", { name: "Janela simples" });
  await expect(panel).toBeVisible();
  const main = await width(page, '[data-slot="workbench-main"]');
  await expect
    .poll(() => width(page, '[data-slot="workbench-panel"]'))
    .toBe(main);

  await page.goto("/platform/design/workbench?demo=edit");
  await page.getByRole("button", { name: "Contatos de exemplo" }).click();
  const list = page.getByRole("dialog", { name: "Contatos de exemplo" });
  await expect(list).toBeVisible();
  await list.getByRole("button", { name: /Carla Dias/ }).click();
  await expect(
    page.getByRole("complementary", { name: "Editar contato" }),
  ).toBeVisible();
});
