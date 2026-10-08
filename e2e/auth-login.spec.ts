import { expect, test } from "@playwright/test";

import {
  DEFAULT_PASSWORD,
  countProfiles,
  createIdentity,
  signIn,
  submitLogin,
  uniqueEmail,
} from "./support/identity";

test("rejects wrong credentials without revealing the account", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("login-wrong");
  await createIdentity(request, email);

  await submitLogin(page, email, "senha-errada-12345");

  await expect(page.getByTestId("error-notice")).toHaveText(
    "E-mail ou senha inválidos.",
  );
  await expect(page).toHaveURL(/\/login$/);
});

test("signs in, provisions the profile and signs out", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("login-ok");
  await createIdentity(request, email);

  await signIn(page, email);

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("identity-email")).toHaveText(email);

  // The protected service revalidates on the server, not through the proxy.
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ email, status: "active" });

  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
  await expect(page.getByTestId("arrival-notice")).toBeVisible();

  const afterSignOut = await page.request.get("/api/v1/me");
  expect(afterSignOut.status()).toBe(401);
});

test("sends an anonymous visitor to login and back to the requested page", async ({
  page,
}) => {
  await page.goto("/app/account/security");
  await expect(page).toHaveURL(
    `/login?next=${encodeURIComponent("/app/account/security")}`,
  );
});

test("answers 401 on a protected service without a session", async ({
  request,
}) => {
  const response = await request.get("/api/v1/me");
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({
    error: { code: "unauthenticated" },
  });
});

test("provisions the profile once, not once per sign-in", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("login-twice");
  await createIdentity(request, email, DEFAULT_PASSWORD);
  expect(await countProfiles(request, email)).toBe(0);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);
  expect(await countProfiles(request, email)).toBe(1);

  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);
  expect(await countProfiles(request, email)).toBe(1);
});
