/**
 * ============================================================================
 * File: e2e/api.spec.ts
 * Module: End-to-End Tests for the REST API v1 (F4a, Especificação §15)
 *
 * Maintenance Rationale:
 * - The browser session reads the core routes of its own workspace; without
 *   a session the API answers 401 with code, message and requestId.
 * - The OpenAPI contract is public and lists the routes with their scopes.
 * - "API e Webhooks" shows the base URL, the workspace id and the routes.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

test("the session reads its workspace through the API; anonymous calls get 401", async ({
  page,
  request,
}) => {
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("api-owner");
  const wsSlug = `api-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `API ${stamp}`,
    orgSlug: `api-org-${stamp}`,
    wsName: `Workspace API ${stamp}`,
    wsSlug,
    role: "owner",
  });

  const anonymous = await request.get("/api/v1/me/workspaces");
  expect(anonymous.status()).toBe(401);
  expect((await anonymous.json()).error).toMatchObject({
    code: "unauthenticated",
    // The API always speaks English (I5).
    message: "Authentication required.",
    requestId: expect.any(String),
  });

  const openapi = await request.get("/api/v1/openapi.json");
  expect(openapi.status()).toBe(200);
  const doc = await openapi.json();
  expect(doc.paths["/workspaces/{id}/members"].get["x-required-scope"]).toBe(
    "members:read",
  );

  await signIn(page, email);
  const mine = await page.request.get("/api/v1/me/workspaces");
  expect(mine.status()).toBe(200);
  const workspace = (await mine.json()).data.find(
    (w: { slug: string }) => w.slug === wsSlug,
  );
  expect(workspace).toMatchObject({ role: "owner" });
  expect(mine.headers()["x-request-id"]).toBeTruthy();

  const members = await page.request.get(
    `/api/v1/workspaces/${workspace.id}/members`,
  );
  expect(members.status()).toBe(200);
  expect((await members.json()).data).toHaveLength(1);

  await page.goto(`/app/${wsSlug}/settings/api`);
  await expect(page.getByTestId("api-workspace-id")).toHaveText(workspace.id);
  await expect(page.getByTestId("api-routes")).toContainText(
    "GET /workspaces/{id}/overview",
  );
});
