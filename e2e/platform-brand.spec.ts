/**
 * ============================================================================
 * File: e2e/platform-brand.spec.ts
 * Module: End-to-End Tests for the brand editor (/platform/settings/brand)
 *
 * Maintenance Rationale:
 * - ADR 0012, P3: a platform owner saves a brand version (name, color, logo)
 *   and the platform host serves it: page title, color tokens and logo.
 * - CF2: Marca lives in Configurações (the old path redirects); favicon,
 *   share image, tagline, WhatsApp and footer reach the login and the
 *   page metadata.
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
import { statusBanner } from "./support/status";

// 1x1 transparent PNG (square, so it is also a valid favicon).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("platform owner saves a brand version and the host serves it", async ({
  page,
  request,
  browser,
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

  // The old address opens the page inside Configurações.
  await page.goto("/platform/brand");
  await expect(page).toHaveURL(/\/platform\/settings\/brand$/);
  await expect(
    page.getByTestId("settings-nav").getByRole("link", { name: "Marca" }),
  ).toHaveAttribute("aria-current", "page");

  await page.getByLabel("Nome exibido").fill("Agência E2E");
  await page.getByLabel("Cor primária (#rrggbb, opcional)").fill("#FFEB3B");
  await page.getByLabel("Logo (PNG, JPEG ou WebP, até 256 KB)").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByLabel("Frase de apresentação").fill("Atendimento que vende");
  await page
    .getByLabel("Favicon (PNG quadrado ou ICO, até 64 KB)")
    .setInputFiles({ name: "favicon.png", mimeType: "image/png", buffer: PNG });
  await page
    .getByLabel("Imagem de compartilhamento (PNG, JPEG ou WebP, até 512 KB)")
    .setInputFiles({
      name: "share.png",
      mimeType: "image/png",
      buffer: PNG,
    });
  await page.getByLabel("WhatsApp de vendas").fill("+55 11 99999-9999");
  await page.getByLabel("Texto do botão").fill("Fale com vendas E2E");
  await page.getByLabel("Mensagem inicial").fill("Olá");
  await page
    .getByLabel("Texto do rodapé")
    .fill("Agência E2E Ltda. https://example.com/termos");
  // The preview follows the typed values before saving.
  await expect(page.getByTestId("brand-preview")).toContainText(
    "Atendimento que vende",
  );
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(statusBanner(page.getByTestId("brand-form"))).toContainText(
    "Marca salva",
  );

  // Signed out, the login shows the tagline, the sales button and the
  // footer; the page carries the favicon and the share image.
  const visitor = await browser.newContext();
  const login = await visitor.newPage();
  await login.goto("/login");
  await expect(login.getByTestId("brand-tagline")).toHaveText(
    "Atendimento que vende",
  );
  await expect(login.getByTestId("brand-whatsapp")).toHaveText(
    "Fale com vendas E2E",
  );
  await expect(login.getByTestId("brand-whatsapp")).toHaveAttribute(
    "href",
    "https://wa.me/5511999999999?text=Ol%C3%A1",
  );
  await expect(
    login.getByTestId("brand-footer").getByRole("link"),
  ).toHaveAttribute("href", "https://example.com/termos");
  const icon = await login
    .locator('link[rel="icon"]')
    .first()
    .getAttribute("href");
  expect(icon).toMatch(/^\/brand\/favicon\/\d+/);
  const favicon = await request.get(icon!);
  expect(favicon.headers()["content-type"]).toBe("image/png");
  await expect(login.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/brand\/share\/\d+$/,
  );
  await visitor.close();

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
  await expect(statusBanner(page.getByTestId("brand-form"))).toContainText(
    "Use um logo PNG, JPEG ou WebP.",
  );

  // Restore the default brand for the other specs.
  await page
    .getByLabel("Logo (PNG, JPEG ou WebP, até 256 KB)")
    .setInputFiles([]);
  await page.getByLabel("Nome exibido").fill("GUIDU");
  await page.getByLabel("Cor primária (#rrggbb, opcional)").fill("");
  await page.getByLabel("Remover o logo atual").check();
  await page.getByLabel("Remover o favicon atual").check();
  await page.getByLabel("Remover a imagem de compartilhamento atual").check();
  await page.getByLabel("Frase de apresentação").fill("");
  await page.getByLabel("WhatsApp de vendas").fill("");
  await page.getByLabel("Texto do botão").fill("");
  await page.getByLabel("Mensagem inicial").fill("");
  await page.getByLabel("Texto do rodapé").fill("");
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(statusBanner(page.getByTestId("brand-form"))).toContainText(
    "Marca salva",
  );
});
