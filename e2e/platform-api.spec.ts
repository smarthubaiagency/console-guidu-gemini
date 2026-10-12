/**
 * ============================================================================
 * File: e2e/platform-api.spec.ts
 * Module: End-to-End Tests for the platform API and MCP (F4e)
 *
 * Maintenance Rationale:
 * - A platform owner with MFA creates an administrative key in Plataforma ›
 *   Chaves de API; the key reads /api/v1/platform and lists and calls the
 *   /mcp/platform tools; it is refused by the workspace MCP and REST (AC09)
 *   and stops working once revoked.
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

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

test("a platform owner reads the platform API and MCP with an administrative key", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("platform-api");
  await createIdentity(request, email);
  await makePlatformAdmin(request, email);
  await signIn(page, email);
  await page.goto("/app/account/security");
  await page.getByTestId("start-mfa-enrolment").click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim();
  await page.getByLabel("Código de seis dígitos").fill(totpCode(secret!));
  await page.getByRole("button", { name: "Confirmar ativação" }).click();
  await expect(page.getByTestId("mfa-factors")).toBeVisible();

  await page.goto("/platform");
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("link", { name: "Chaves de API" })
    .click();
  const form = page.getByTestId("create-platform-key");
  await form.getByLabel("Nome da chave").fill("E2E Plataforma");
  await form.getByLabel(/Clientes \(admin:customers:read\)/).check();
  await form.getByLabel(/Operações \(admin:operations:read\)/).check();
  await form.getByRole("button", { name: "Criar chave" }).click();
  const key = (await page.getByTestId("platform-raw-key").innerText()).trim();
  expect(key).toMatch(/^gdu_admin_[0-9a-f]{64}$/);

  const auth = { authorization: `Bearer ${key}` };
  const customers = await request.get("/api/v1/platform/customers", {
    headers: auth,
  });
  expect(customers.status()).toBe(200);
  expect(Array.isArray((await customers.json()).data)).toBe(true);
  const health = await request.get("/api/v1/platform/health", {
    headers: auth,
  });
  expect(health.status()).toBe(200);
  expect((await request.get("/api/v1/platform/customers")).status()).toBe(401);

  const rpc = (path: string, method: string, params = {}) =>
    request.post(path, {
      headers: { ...MCP_HEADERS, ...auth },
      data: { jsonrpc: "2.0", id: 1, method, params },
    });
  const tools = await rpc("/mcp/platform", "tools/list");
  expect(tools.status()).toBe(200);
  expect(
    (await tools.json()).result.tools.map((t: { name: string }) => t.name),
  ).toEqual(
    expect.arrayContaining([
      "list_customers",
      "get_customer_summary",
      "get_platform_health",
      "list_failed_jobs",
    ]),
  );
  const called = await rpc("/mcp/platform", "tools/call", {
    name: "get_platform_health",
    arguments: {},
  });
  expect((await called.json()).result.isError).toBeFalsy();

  // AC09: the administrative key never reaches workspace routes.
  expect((await rpc("/mcp/workspace", "tools/list")).status()).toBe(401);
  expect(
    (
      await request.get(
        "/api/v1/workspaces/00000000-0000-4000-8000-000000000001",
        { headers: auth },
      )
    ).status(),
  ).toBe(401);

  await page.reload();
  await page.getByRole("button", { name: "Revogar" }).click();
  await expect(page.getByTestId("platform-key-status")).toHaveText("Revogada");
  expect(
    (
      await request.get("/api/v1/platform/customers", { headers: auth })
    ).status(),
  ).toBe(401);
});
