import { expect, type Page, type APIRequestContext } from "@playwright/test";

import { AUTH_BASE_URL } from "./rig";

/** Helpers the identity specs share. Each spec owns its own synthetic user. */

export const DEFAULT_PASSWORD = "senha-de-teste-12345";

let sequence = 0;

export function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.test`;
}

export async function createIdentity(
  request: APIRequestContext,
  email: string,
  password: string = DEFAULT_PASSWORD,
): Promise<string> {
  const response = await request.post(`${AUTH_BASE_URL}/__control/users`, {
    data: { email, password },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

export async function readRecoveryToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.get(
    `${AUTH_BASE_URL}/__control/recovery?email=${encodeURIComponent(email)}`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { token_hash: string };
  return body.token_hash;
}

/** `count(*)` of profile rows for the identity. */
export async function countProfiles(
  request: APIRequestContext,
  email: string,
): Promise<number> {
  const response = await request.get(
    `${AUTH_BASE_URL}/__control/profiles?email=${encodeURIComponent(email)}`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { count: number };
  return body.count;
}

/** Blocks the identity in the database, leaving its session untouched. */
export async function blockIdentity(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const response = await request.post(`${AUTH_BASE_URL}/__control/block`, {
    data: { email },
  });
  expect(response.status()).toBe(200);
}

/** Seeds the user as an active platform administrator in the database. */
export async function makePlatformAdmin(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const response = await request.post(`${AUTH_BASE_URL}/__control/platform-admin`, {
    data: { email },
  });
  expect(response.status()).toBe(200);
}

/** Seeds an organization, workspace and user membership in the database. */
export async function seedWorkspace(
  request: APIRequestContext,
  params: {
    email: string;
    orgName: string;
    orgSlug: string;
    wsName: string;
    wsSlug: string;
    role?: "owner" | "admin" | "member" | "viewer";
  },
): Promise<{ organizationId: string; workspaceId: string }> {
  const response = await request.post(`${AUTH_BASE_URL}/__control/seed-workspace`, {
    data: params,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { organizationId: string; workspaceId: string };
}

/** Seeds an invitation in the database and returns rawToken for testing. */
export async function seedInvitation(
  request: APIRequestContext,
  params: {
    organizationId: string;
    workspaceId?: string | undefined;
    email: string;
    role?: ("owner" | "admin" | "member" | "viewer") | undefined;
    expiresInHours?: number | undefined;
  },
): Promise<{ id: string; rawToken: string }> {
  const response = await request.post(`${AUTH_BASE_URL}/__control/seed-invitation`, {
    data: params,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { id: string; rawToken: string };
}

/** Seeds a partner with an active domain and a member (ADR 0012). */
export async function seedPartner(
  request: APIRequestContext,
  params: {
    slug: string;
    name: string;
    host: string;
    memberEmail: string;
    role: "partner_owner" | "partner_admin" | "partner_finance" | "partner_support";
    organizationId?: string;
  },
): Promise<{ partnerId: string }> {
  const response = await request.post(`${AUTH_BASE_URL}/__control/seed-partner`, {
    data: params,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { partnerId: string };
}

/** Fills and submits the login form without waiting for the outcome. */
export async function submitLogin(
  page: Page,
  email: string,
  password: string = DEFAULT_PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/**
 * Signs in and waits until the Server Action has redirected away from
 * `/login`. Where it lands is the assertion of each spec — `/app`,
 * `/auth/mfa` or `/auth/suspended`.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string = DEFAULT_PASSWORD,
): Promise<void> {
  await submitLogin(page, email, password);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
