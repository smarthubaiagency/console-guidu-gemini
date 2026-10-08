import { expect, test } from "@playwright/test";

import {
  createIdentity,
  readRecoveryToken,
  signIn,
  uniqueEmail,
} from "./support/identity";

const NEW_PASSWORD = "nova-senha-de-teste-123";

test("recovers access through the e-mail link and invalidates the link", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("recovery");
  await createIdentity(request, email);

  await page.goto("/forgot-password");
  await page.getByLabel("E-mail").fill(email);
  await page
    .getByRole("button", { name: "Enviar link de recuperação" })
    .click();
  await expect(page.getByTestId("success-notice")).toContainText(
    "enviamos um link de recuperação",
  );

  const token = await readRecoveryToken(request, email);
  await page.goto(
    `/auth/callback?token_hash=${token}&type=recovery&next=%2Freset-password`,
  );
  await expect(page).toHaveURL(/\/reset-password$/);

  await page.getByLabel("Nova senha", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirme a nova senha").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();

  await expect(page).toHaveURL(/\/login\?notice=password-updated$/);

  // The same link cannot be replayed.
  await page.goto(
    `/auth/callback?token_hash=${token}&type=recovery&next=%2Freset-password`,
  );
  await expect(page).toHaveURL(/\/login\?error=recovery$/);
  await expect(page.getByTestId("arrival-error")).toBeVisible();

  await signIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/app$/);
});

test("refuses a short password and keeps the user on the form", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("recovery-weak");
  await createIdentity(request, email);

  await page.goto("/forgot-password");
  await page.getByLabel("E-mail").fill(email);
  await page
    .getByRole("button", { name: "Enviar link de recuperação" })
    .click();
  await expect(page.getByTestId("success-notice")).toBeVisible();

  const token = await readRecoveryToken(request, email);
  await page.goto(
    `/auth/callback?token_hash=${token}&type=recovery&next=%2Freset-password`,
  );

  await page.getByLabel("Nova senha", { exact: true }).fill("curta");
  await page.getByLabel("Confirme a nova senha").fill("curta");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();

  await expect(page.getByTestId("error-notice")).toContainText("12 caracteres");
  await expect(page).toHaveURL(/\/reset-password$/);
});

test("rejects a reset page reached without the recovery session", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/login\?error=recovery$/);
});
