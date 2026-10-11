/**
 * ============================================================================
 * File: e2e/mcp.spec.ts
 * Module: End-to-End Tests for the workspace MCP (F4b, Especificação §17)
 *
 * Maintenance Rationale:
 * - The owner issues a key in Configurações › MCP (default read scopes) and
 *   the page shows the server address; a JSON-RPC client then initializes,
 *   lists the tools of those scopes and calls get_workspace over
 *   Streamable HTTP, as Claude Code or Codex would.
 * - Without the key the server answers 401.
 * ============================================================================
 */

import { expect, test } from "@playwright/test";

import {
  createIdentity,
  seedWorkspace,
  signIn,
  uniqueEmail,
} from "./support/identity";

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

test("an MCP client lists and calls the read tools with a workspace key", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const email = uniqueEmail("mcp-owner");
  const wsSlug = `mcp-${stamp}`;
  await createIdentity(request, email);
  await seedWorkspace(request, {
    email,
    orgName: `MCP ${stamp}`,
    orgSlug: `mcp-org-${stamp}`,
    wsName: `Workspace MCP ${stamp}`,
    wsSlug,
    role: "owner",
  });
  await signIn(page, email);
  await page.goto(`/app/${wsSlug}/settings/mcp`);
  await expect(page.getByTestId("mcp-url")).toContainText("/mcp/workspace");

  await page.getByRole("button", { name: "Emitir Nova Chave" }).click();
  await page.getByPlaceholder(/Conector Cursor|Nome da Chave/i).fill("E2E MCP");
  await page.getByRole("button", { name: /Emitir Chave/i }).click();
  const key = (
    await page
      .getByText(/gdu_live_[a-f0-9]{64}/)
      .first()
      .innerText()
  ).match(/gdu_live_[a-f0-9]{64}/)?.[0];
  expect(key).toBeTruthy();

  const rpc = (
    method: string,
    params: Record<string, unknown> = {},
    auth = true,
  ) =>
    request.post("/mcp/workspace", {
      headers: auth ? { ...HEADERS, authorization: `Bearer ${key}` } : HEADERS,
      data: { jsonrpc: "2.0", id: 1, method, params },
    });

  expect((await rpc("tools/list", {}, false)).status()).toBe(401);

  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1.0.0" },
  });
  expect(init.status()).toBe(200);
  expect((await init.json()).result.serverInfo.name).toBe("guidu-workspace");

  const list = await rpc("tools/list");
  const names = (await list.json()).result.tools.map(
    (t: { name: string }) => t.name,
  );
  // Default key scopes: workspace:read and modules:read.
  expect(names).toEqual(
    expect.arrayContaining(["get_workspace", "list_enabled_modules"]),
  );
  expect(names).not.toContain("list_workspace_members");

  const called = await rpc("tools/call", {
    name: "get_workspace",
    arguments: {},
  });
  const result = (await called.json()).result;
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent.slug).toBe(wsSlug);
});
