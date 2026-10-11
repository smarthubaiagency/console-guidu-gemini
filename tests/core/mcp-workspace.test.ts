import { randomBytes, randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ApiDeps } from "@/core/api/handler";
import { API_KEY_PREFIX, hashApiKey } from "@/core/credentials/api-keys";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const URL_MCP = "http://localhost:3000/mcp/workspace";
const ALL_READ = [
  "workspace:read",
  "modules:read",
  "usage:read",
  "executions:read",
  "members:read",
];

describeDatabase("F4b: workspace MCP (§17, AC09, AC10)", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const deps: ApiDeps = {
    prisma,
    redis: null,
    session: async () => {
      throw new Error("MCP never uses the session");
    },
  };
  const keys: string[] = [];
  const clients: Client[] = [];
  let otherRun = "";

  /** The handler behind a fetch, as the route serves it. */
  const fetchVia =
    (extraHeaders: Record<string, string> = {}) =>
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const headers = new Headers(request.headers);
      headers.set("host", "localhost:3000");
      for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
      return handleMcpWorkspaceRequest(new Request(request, { headers }), deps);
    };

  async function createKey(scopes: string[]): Promise<string> {
    const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
    const id = randomUUID();
    await admin.$executeRawUnsafe(
      `insert into public.api_keys
         (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${id}', '${ids.organizationA}', '${ids.workspaceA}', '${ids.userA}', 'F4b',
               '${raw.slice(0, 16)}', '${hashApiKey(raw)}', $1::text[], now() + interval '1 day')`,
      scopes,
    );
    keys.push(id);
    return raw;
  }

  async function connect(key: string): Promise<Client> {
    const client = new Client({ name: "guidu-test", version: "1.0.0" });
    // The SDK's own types disagree under exactOptionalPropertyTypes.
    await client.connect(
      <never>new StreamableHTTPClientTransport(new URL(URL_MCP), {
        requestInit: { headers: { authorization: `Bearer ${key}` } },
        fetch: fetchVia(),
      }),
    );
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    otherRun = randomUUID();
    await admin.$executeRawUnsafe(
      `insert into public.job_runs (id, kind, organization_id, workspace_id, requested_by, idempotency_key)
       values ('${otherRun}', 'hello-world.create-record', '${ids.organizationB}', '${ids.workspaceB}',
               '${ids.userB}', 'f4b-${otherRun}')`,
    );
  });

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined);
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where id = '${otherRun}'`,
    );
    if (keys.length) {
      await admin.$executeRawUnsafe(
        `delete from public.api_keys where id in (${keys.map((k) => `'${k}'`).join(",")})`,
      );
    }
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("lists only the tools the key's scopes allow (AC10)", async () => {
    const full = await connect(await createKey(ALL_READ));
    const names = (await full.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_execution_status",
      "get_module_status",
      "get_usage_summary",
      "get_workspace",
      "get_workspace_overview",
      "list_enabled_modules",
      "list_executions",
      "list_workspace_members",
    ]);
    const tool = (await full.listTools()).tools.find(
      (t) => t.name === "get_workspace",
    );
    expect(tool?.annotations?.readOnlyHint).toBe(true);

    const narrow = await connect(await createKey(["workspace:read"]));
    expect((await narrow.listTools()).tools.map((t) => t.name).sort()).toEqual([
      "get_workspace",
      "get_workspace_overview",
    ]);
    // A tool outside the list is not callable either.
    const denied = await narrow
      .callTool({ name: "list_workspace_members", arguments: {} })
      .catch((error: Error) => ({
        isError: true,
        content: [{ text: error.message }],
      }));
    expect(denied.isError).toBe(true);
  });

  it("answers from the key's workspace whatever the input says (AC10)", async () => {
    const client = await connect(await createKey(ALL_READ));
    const result = await client.callTool({
      name: "get_workspace",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: ids.workspaceA });

    // Extra arguments are refused; they never select another workspace.
    const forged = await client
      .callTool({
        name: "get_workspace",
        arguments: { workspaceId: ids.workspaceB },
      })
      .catch((error: Error) => ({
        isError: true,
        structuredContent: undefined,
        message: error.message,
      }));
    expect(forged.isError).toBe(true);
    expect(JSON.stringify(forged)).not.toContain("Organization B");

    // An execution of another workspace does not exist for this key.
    const other = await client.callTool({
      name: "get_execution_status",
      arguments: { executionId: otherRun },
    });
    expect(other.isError).toBe(true);
    expect(JSON.stringify(other.content)).toContain("Execução não encontrada");

    const members = await client.callTool({
      name: "list_workspace_members",
      arguments: { limit: 1 },
    });
    expect(
      (members.structuredContent as { items: unknown[] }).items,
    ).toHaveLength(1);

    const audits = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from public.audit_events
       where action = 'mcp.tool.call' and resource_id = 'get_workspace'
         and actor_user_id = '${ids.userA}'`,
    );
    expect(Number(audits[0]?.n)).toBeGreaterThan(0);
  });

  it("refuses requests without a valid key, from a foreign Origin or by GET (AC09)", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const post = (headers: Record<string, string>) =>
      fetchVia(headers)(URL_MCP, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body,
      });
    const noKey = await post({});
    expect(noKey.status).toBe(401);
    expect(noKey.headers.get("www-authenticate")).toContain("Bearer");
    expect(
      (
        await post({
          authorization: `Bearer ${API_KEY_PREFIX}${"0".repeat(64)}`,
        })
      ).status,
    ).toBe(401);

    const key = await createKey(["workspace:read"]);
    expect(
      (
        await post({
          authorization: `Bearer ${key}`,
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    const get = await fetchVia()(URL_MCP, {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    });
    expect(get.status).toBe(405);

    // Revocation applies to the next request.
    await admin.$executeRawUnsafe(
      `update public.api_keys set status = 'revoked', revoked_at = now() where key_hash = '${hashApiKey(key)}'`,
    );
    expect((await post({ authorization: `Bearer ${key}` })).status).toBe(401);
  });
});
