/**
 * ============================================================================
 * File: e2e/platform-brand.spec.ts
 * Module: End-to-End Tests for the brand editor (/platform/brand)
 *
 * Maintenance Rationale:
 * - ADR 0012, P3: a platform owner saves a brand version (name, color, logo)
 *   and the platform host serves it: page title, color tokens and logo.
 * - The test restores the default name at the end because other specs read
 *   the brand of the same database.
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

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("platform owner saves a brand version and the host serves it", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("brand-owner");
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await signIn(page, email);

  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  await page.goto("/platform/brand");
  await page.getByLabel("Nome exibido").fill("Agência E2E");
  await page.getByLabel("Cor primária (#rrggbb, opcional)").fill("#FFEB3B");
  await page.getByLabel("Logo (PNG, JPEG ou WebP, até 256 KB)").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(
    page.getByTestId("brand-form").getByRole("status"),
  ).toContainText("Marca salva");

  await page.reload();
  await expect(page.getByTestId("brand-current-name")).toHaveText(
    "Agência E2E",
  );
  await expect(page.locator("style#brand-tokens")).toHaveCount(1);
  const tokens = await page.locator("style#brand-tokens").textContent();
  expect(tokens).toContain("--color-primary:#ffeb3b;");
  expect(tokens).toContain("--color-on-primary:#000000;");

  const logoSrc = await page
    .getByTestId("brand-logo")
    .first()
    .getAttribute("src");
  expect(logoSrc).toMatch(/^\/brand\/logo\/\d+$/);
  const logo = await request.get(logoSrc!);
  expect(logo.status()).toBe(200);
  expect(logo.headers()["content-type"]).toBe("image/png");
  expect(logo.headers()["x-content-type-options"]).toBe("nosniff");

  // A disguised SVG is refused by its signature, not by its name.
  await page.getByLabel("Logo (PNG, JPEG ou WebP, até 256 KB)").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(page.getByTestId("brand-form").getByRole("alert")).toContainText(
    "Use um logo PNG, JPEG ou WebP.",
  );

  // Restore the default brand for the other specs.
  await page
    .getByLabel("Logo (PNG, JPEG ou WebP, até 256 KB)")
    .setInputFiles([]);
  await page.getByLabel("Nome exibido").fill("GUIDU");
  await page.getByLabel("Cor primária (#rrggbb, opcional)").fill("");
  await page.getByLabel("Remover o logo atual").check();
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(
    page.getByTestId("brand-form").getByRole("status"),
  ).toContainText("Marca salva");
});
