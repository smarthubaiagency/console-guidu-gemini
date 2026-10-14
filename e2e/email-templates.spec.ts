/**
 * ============================================================================
 * File: e2e/email-templates.spec.ts
 * Module: End-to-End Tests for the e-mail templates (CF3b)
 *
 * Maintenance Rationale:
 * - The rig points Resend at a double (`e2e/support/fake-resend.ts`), so the
 *   spec reads what left the platform.
 * - A platform owner edits the subject and body of the test e-mail in
 *   Configurações › Modelos de e-mail, sees the preview, saves, sends the
 *   test e-mail and the fake receives the new subject and body.
 * - The test restores the default because other specs send test e-mails.
 * ============================================================================
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import { RIG } from "./support/rig";
import {
  createIdentity,
  makePlatformAdmin,
  signIn,
  uniqueEmail,
} from "./support/identity";
import { statusBanner } from "./support/status";
import { totpCode } from "./support/totp";

type Sent = { from: string; subject: string; text: string };

async function sentTo(request: APIRequestContext, email: string) {
  const response = await request.get(
    `http://127.0.0.1:${RIG.resendPort}/__sent?to=${encodeURIComponent(email)}`,
  );
  return ((await response.json()) as { sent: Sent[] }).sent;
}

test("a platform owner edits the test e-mail template and sends it", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("email-templates");
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  await page.goto("/platform/settings");
  await page
    .getByTestId("settings-nav")
    .getByRole("link", { name: "Modelos de e-mail" })
    .click();
  await expect(page).toHaveURL(/\/platform\/settings\/email\/templates$/);
  await page.getByTestId("email-template-event-emailTest").click();
  await expect(page).toHaveURL(/event=email\.test/);

  const editor = page.getByTestId("email-template-editor");
  await editor.getByTestId("template-locale-pt-BR").click();
  const form = editor.getByTestId("email-template-form");
  await expect(form.getByTestId("template-inherited")).toBeVisible();

  // An unknown tag is refused beside the field and blocks saving.
  await form.getByLabel("Assunto").fill("Teste {{senha}}");
  await expect(form.getByRole("alert")).toContainText("senha");
  await expect(form.getByTestId("template-save")).toBeDisabled();

  await form.getByLabel("Assunto").fill("Modelo E2E de {{marca}}");
  await form
    .getByRole("textbox", { name: "Corpo" })
    .fill("## Olá\n\nEste é o **modelo editado**.\n\n[Abrir]({{link}})");
  const preview = editor.getByTestId("template-preview");
  await expect(preview.getByRole("heading", { name: "Olá" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("modelo editado");
  await expect(preview.getByRole("link", { name: "Abrir" })).toHaveAttribute(
    "href",
    /^https?:\/\//,
  );
  await form.getByTestId("template-save").click();
  await expect(statusBanner(page)).toContainText("Modelo salvo.");
  await expect(form.getByTestId("template-custom")).toBeVisible();

  await page.goto("/platform/settings/email");
  await page
    .getByTestId("email-test")
    .getByRole("button", { name: "Enviar e-mail de teste" })
    .click();
  await expect(statusBanner(page)).toContainText(
    `E-mail de teste enviado para ${email}`,
  );
  const [testEmail] = await sentTo(request, email);
  expect(testEmail?.subject).toMatch(/^Modelo E2E de /);
  expect(testEmail?.text).toContain("Este é o modelo editado.");

  // Back to the default: other specs check the default test e-mail.
  await page.goto("/platform/settings/email/templates?event=email.test");
  const restoreForm = page
    .getByTestId("email-template-editor")
    .getByTestId("email-template-form");
  await restoreForm.getByTestId("template-restore").click();
  const question = statusBanner(page);
  await expect(question).toHaveAttribute("role", "alertdialog");
  await question.getByTestId("smart-status-action").click();
  await expect(statusBanner(page)).toContainText(
    "Modelo restaurado para o padrão.",
  );
  await expect(restoreForm.getByTestId("template-inherited")).toBeVisible();
  await expect(restoreForm.getByLabel("Assunto")).toHaveValue(
    "E-mail de teste de {{marca}}",
  );
});
