import { expect, test } from "@playwright/test";

import { createIdentity, signIn, uniqueEmail } from "./support/identity";
import { totpCode } from "./support/totp";

test("administration is closed to a session without a second factor", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("mfa-missing");
  await createIdentity(request, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);

  // The page guard sends the visitor to enrolment; the service answers 403.
  const adminApi = await page.request.get("/api/v1/admin/session");
  expect(adminApi.status()).toBe(403);
  expect(await adminApi.json()).toMatchObject({
    error: { code: "mfa_required" },
  });

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/app\/account\/security\?reason=mfa-required/);
  await expect(page.getByTestId("mfa-required-state")).toBeVisible();
});

test("enrols TOTP, then requires it on the next sign-in and opens /admin", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("mfa-enrol");
  await createIdentity(request, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();

  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  expect(secret).toBeTruthy();

  await page.getByLabel("Código de seis dígitos").fill("000000");
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("error-notice")).toContainText(
    "Código inválido",
  );

  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  // The action revalidates the page, which then lists the verified factor.
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  // The session that enrolled the factor already carries aal2.
  await page.goto("/admin");
  await expect(page.getByTestId("admin-state")).toBeVisible();

  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login/);

  // A fresh password sign-in is aal1 and has to pass the challenge.
  await signIn(page, email);
  await expect(page).toHaveURL(/\/auth\/mfa/);

  await page.getByLabel("Código do aplicativo autenticador").fill("111111");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByTestId("error-notice")).toContainText(
    "Código inválido",
  );

  await page
    .getByLabel("Código do aplicativo autenticador")
    .fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/admin");
  await expect(page.getByTestId("admin-identity")).toHaveText(email);

  const adminApi = await page.request.get("/api/v1/admin/session");
  expect(adminApi.status()).toBe(200);
  expect(await adminApi.json()).toMatchObject({ mfaSatisfied: true });
});
