/**
 * ============================================================================
 * File: e2e/email.spec.ts
 * Module: End-to-End Tests for e-mail sending (CF3a)
 *
 * Maintenance Rationale:
 * - The rig points Resend at a double (`e2e/support/fake-resend.ts`), so the
 *   specs read what left the platform.
 * - A platform owner sets the default sender name in Configurações › E-mail
 *   and sends the test e-mail, which leaves with that name.
 * - A workspace invitation goes out by e-mail with the invite link.
 * - The test restores the sender name because other specs send e-mails.
 * ============================================================================
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import { RIG } from "./support/rig";
import {
  createIdentity,
  makePlatformAdmin,
  seedWorkspace,
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

test("a platform owner sets the sender and sends the test e-mail", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("email-owner");
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
    .getByRole("link", { name: "E-mail" })
    .click();
  await expect(page).toHaveURL(/\/platform\/settings\/email$/);
  await expect(page.getByTestId("email-state")).toContainText(
    "Ligado (Resend)",
  );

  const sender = page.getByTestId("email-sender");
  await sender.getByLabel("Nome do remetente").fill("GUIDU Avisos E2E");
  await sender.getByLabel("Responder para").fill("ajuda@guidu.test");
  await sender.getByRole("button", { name: "Salvar remetente" }).click();
  await expect(statusBanner(page)).toContainText("Configurações salvas.");
  await expect(page.getByTestId("email-from").locator("dd")).toHaveText(
    '"GUIDU Avisos E2E" <avisos@guidu.test>',
  );
  await expect(page.getByTestId("email-reply-to").locator("dd")).toHaveText(
    "ajuda@guidu.test",
  );

  await page
    .getByTestId("email-test")
    .getByRole("button", { name: "Enviar e-mail de teste" })
    .click();
  await expect(statusBanner(page)).toContainText(
    `E-mail de teste enviado para ${email}`,
  );
  const [testEmail] = await sentTo(request, email);
  expect(testEmail?.subject).toContain("E-mail de teste de");
  expect(testEmail?.from).toBe('"GUIDU Avisos E2E" <avisos@guidu.test>');

  // Back to the brand's name: other specs send e-mails too.
  await sender.getByLabel("Nome do remetente").fill("");
  await sender.getByLabel("Responder para").fill("");
  await sender.getByRole("button", { name: "Salvar remetente" }).click();
  await expect(statusBanner(page)).toContainText("Configurações salvas.");
  await expect(page.getByTestId("email-reply-to").locator("dd")).toHaveText(
    "-",
  );
});

test("a workspace invitation goes out by e-mail", async ({ page, request }) => {
  const email = uniqueEmail("email-team");
  const wsSlug = `ws-email-${Date.now()}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: "Equipe E-mail",
    orgSlug: `org-email-${Date.now()}`,
    wsName: "Workspace E-mail",
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}/settings/team`);
  await page.getByRole("button", { name: "Convidar Membro" }).click();
  const invited = uniqueEmail("email-invitee");
  await page.getByPlaceholder("usuario@empresa.com").fill(invited);
  await page.getByRole("button", { name: "Gerar Convite" }).click();
  await expect(statusBanner(page)).toContainText(
    `Convite enviado por e-mail para ${invited}`,
  );

  const [invitation] = await sentTo(request, invited);
  expect(invitation?.subject).toContain("Convite para Equipe E-mail");
  expect(invitation?.text).toMatch(/\/invite\/[A-Za-z0-9_-]+/);
});
