import { expect, test } from "@playwright/test";

import {
  blockIdentity,
  createIdentity,
  signIn,
  uniqueEmail,
} from "./support/identity";

/**
 * AC03: blocking an identity stops new operations immediately, while the
 * access token it already holds is still valid. Nothing is signed out and no
 * cookie is cleared between the block and the assertions below.
 */

test("blocks new operations on a live session (AC03)", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("blocked-live");
  await createIdentity(request, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);

  const before = await page.request.get("/api/v1/me");
  expect(before.status()).toBe(200);

  await blockIdentity(request, email);

  // Same cookies, same unexpired JWT: the server-side status check denies.
  const after = await page.request.get("/api/v1/me");
  expect(after.status()).toBe(403);
  expect(await after.json()).toMatchObject({
    error: { code: "identity_blocked" },
  });

  await page.goto("/app");
  await expect(page).toHaveURL(/\/auth\/suspended$/);
  await expect(page.getByTestId("suspended-state")).toBeVisible();
});

test("refuses a fresh sign-in by a blocked identity", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("blocked-signin");
  await createIdentity(request, email);

  // First sign-in creates the profile, which is then blocked.
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login/);

  await blockIdentity(request, email);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/auth\/suspended$/);

  // The credentials were correct, yet no usable session was left behind.
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(401);
});
