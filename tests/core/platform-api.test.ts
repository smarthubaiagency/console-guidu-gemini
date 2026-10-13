import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { API_ROUTES } from "@/core/api/contracts";
import { type ApiDeps, handleApiRoute } from "@/core/api/handler";
import * as resources from "@/core/api/resources";
import { API_KEY_PREFIX, hashApiKey } from "@/core/credentials/api-keys";
import { handlePlatformMcpRequest } from "@/core/mcp/platform-server";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withPlatformContext } from "@/core/platform-api/context";
import {
  handlePlatformApiRoute,
  PLATFORM_API_ROUTES,
} from "@/core/platform-api/handler";
import {
  createPlatformApiKey,
  revokePlatformApiKey,
} from "@/core/platform-api/keys";
import * as platform from "@/core/platform-api/resources";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

/** Platform owner of admin-seed.sql and two members created here. */
const owner = "d0000000-0000-4000-8000-000000000003";
const support = "f4e00000-0000-4000-8000-000000000001";
const billing = "f4e00000-0000-4000-8000-000000000002";
const mfa = { mfaVerified: true };
const partnerHost = "plataforma-f4e.test";
const partnerId = "f4e00000-0000-4000-8000-0000000000aa";

describeDatabase("F4e: platform API and MCP", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  let sessionUser: { userId: string; mfaSatisfied: boolean } | null = null;
  const deps: ApiDeps = {
    prisma,
    redis: null,
    session: async () => {
      if (!sessionUser)
        throw new AppError({ code: "unauthenticated", safeMessage: "x" });
      return sessionUser;
    },
  };
  const workspaceKeys: string[] = [];

  async function issue(
    userId: string,
    role: "owner" | "operations" | "billing" | "support",
    scopes: string[],
  ): Promise<string> {
    const { rawKey } = await withPlatformContext(
      prisma,
      { userId, keyId: null },
      (tx) =>
        createPlatformApiKey(
          tx,
          { userId, role },
          { name: "F4e", scopes },
          mfa,
        ),
    );
    return rawKey;
  }

  async function rest(
    route: keyof typeof PLATFORM_API_ROUTES,
    options: Readonly<{ key?: string; host?: string; path?: string }> = {},
  ) {
    const headers = new Headers({ host: options.host ?? "localhost:3000" });
    if (options.key) headers.set("authorization", `Bearer ${options.key}`);
    const request = new Request(
      `http://localhost:3000/api/v1${options.path ?? PLATFORM_API_ROUTES[route].path}`,
      { headers },
    );
    const response = await handlePlatformApiRoute(
      request,
      PLATFORM_API_ROUTES[route],
      deps,
      (call) => {
        switch (route) {
          case "listCustomers":
            return platform.listCustomers(prisma, call.actor, call.query);
          case "getCustomer":
            return platform.getCustomer(prisma, call.actor, ids.organizationA);
          case "getHealth":
            return platform.getPlatformHealth(prisma, call.actor);
          case "listFailedJobs":
            return platform.listFailedJobs(prisma, call.actor, call.query);
        }
      },
    );
    return { status: response.status, body: await response.json() };
  }

  async function mcp(
    handler: typeof handlePlatformMcpRequest,
    path: string,
    key: string,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    const response = await handler(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: {
          host: "localhost:3000",
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
      deps,
    );
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [support, "f4e-support@test.guidu.co"],
      [billing, "f4e-billing@test.guidu.co"],
    ] as const) {
      await admin.$executeRawUnsafe(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values ('00000000-0000-4000-8000-000000000000', '${id}', 'authenticated', 'authenticated',
           '${email}', '', now(), '{}', '{}', now(), now()) on conflict (id) do nothing`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.profiles (id, full_name, status) values ('${id}', 'F4e', 'active')
         on conflict (id) do nothing`,
      );
    }
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status) values
         ('${support}', 'support', 'active'), ('${billing}', 'billing', 'active')
       on conflict (user_id) do update set role = excluded.role, status = 'active'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${partnerId}', 'plataforma-f4e', 'Agência F4e')
       on conflict (id) do nothing`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_domains (host, partner_id, kind, status)
       values ('${partnerHost}', '${partnerId}', 'custom', 'active') on conflict (host) do nothing`,
    );
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      `delete from public.platform_api_keys where user_id in ('${owner}', '${support}', '${billing}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_members where user_id in ('${support}', '${billing}')`,
    );
    if (workspaceKeys.length) {
      await admin.$executeRawUnsafe(
        `delete from public.api_keys where id in (${workspaceKeys.map((k) => `'${k}'`).join(",")})`,
      );
    }
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("creates keys only with MFA, an internal role and the scopes the role allows", async () => {
    await expect(
      withPlatformContext(prisma, { userId: owner, keyId: null }, (tx) =>
        createPlatformApiKey(
          tx,
          { userId: owner, role: "owner" },
          { name: "Sem MFA", scopes: ["admin:customers:read"] },
          { mfaVerified: false },
        ),
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      withPlatformContext(prisma, { userId: ids.userA, keyId: null }, (tx) =>
        createPlatformApiKey(
          tx,
          { userId: ids.userA, role: null },
          { name: "Cliente", scopes: ["admin:customers:read"] },
          mfa,
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // Billing does not read operations.
    await expect(
      issue(billing, "billing", ["admin:operations:read"]),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const key = await issue(owner, "owner", [
      "admin:customers:read",
      "admin:operations:read",
    ]);
    expect(key).toMatch(/^gdu_admin_[0-9a-f]{64}$/);
  });

  it("serves customers and operations to the key's scopes and role", async () => {
    const key = await issue(owner, "owner", [
      "admin:customers:read",
      "admin:operations:read",
    ]);
    const list = await rest("listCustomers", { key });
    expect(list.status).toBe(200);
    const orgA = list.body.data.find(
      (c: { id: string }) => c.id === ids.organizationA,
    );
    expect(orgA).toMatchObject({ name: expect.any(String) });
    expect(orgA.workspaces).toBeGreaterThan(0);
    expect(Object.keys(orgA).sort()).toEqual([
      "createdAt",
      "id",
      "maxSeats",
      "name",
      "plan",
      "status",
      "workspaces",
    ]);
    const one = await rest("getCustomer", {
      key,
      path: `/platform/customers/${ids.organizationA}`,
    });
    expect(one.body.data.id).toBe(ids.organizationA);
    const health = await rest("getHealth", { key });
    expect(health.status).toBe(200);
    expect(health.body.data).toHaveProperty("metrics.totals");
    const failed = await rest("listFailedJobs", { key });
    expect(failed.status).toBe(200);
    for (const job of failed.body.data) {
      expect(Object.keys(job)).not.toContain("payload");
    }

    const opsOnly = await issue(support, "support", ["admin:operations:read"]);
    expect((await rest("listCustomers", { key: opsOnly })).status).toBe(403);
    expect((await rest("getHealth", { key: opsOnly })).status).toBe(200);

    // Support reads customers without plan data (no billing permission).
    const supportCustomers = await issue(support, "support", [
      "admin:customers:read",
    ]);
    const seen = await rest("listCustomers", { key: supportCustomers });
    expect(seen.status).toBe(200);
    expect(
      seen.body.data.every((c: { plan: unknown }) => c.plan === null),
    ).toBe(true);
  });

  it("never mixes platform keys and workspace keys (AC09)", async () => {
    const adminKey = await issue(owner, "owner", ["admin:customers:read"]);
    const workspaceRaw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
    const workspaceKeyId = randomUUID();
    await admin.$executeRawUnsafe(
      `insert into public.api_keys
         (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${workspaceKeyId}', '${ids.organizationA}', '${ids.workspaceA}', '${ids.userA}', 'F4e',
               '${workspaceRaw.slice(0, 16)}', '${hashApiKey(workspaceRaw)}',
               array['workspace:read'], now() + interval '1 day')`,
    );
    workspaceKeys.push(workspaceKeyId);

    // The administrative key on a workspace route and on the workspace MCP.
    const headers = new Headers({
      host: "localhost:3000",
      authorization: `Bearer ${adminKey}`,
    });
    const workspaceRoute = await handleApiRoute(
      new Request(`http://localhost:3000/api/v1/workspaces/${ids.workspaceA}`, {
        headers,
      }),
      API_ROUTES.getWorkspace,
      { id: ids.workspaceA },
      deps,
      (call) => resources.getWorkspace(prisma, call),
    );
    expect(workspaceRoute.status).toBe(401);
    expect(
      (
        await mcp(
          handleMcpWorkspaceRequest,
          "/mcp/workspace",
          adminKey,
          "tools/list",
        )
      ).status,
    ).toBe(401);

    // The workspace key on the platform API and MCP.
    expect((await rest("listCustomers", { key: workspaceRaw })).status).toBe(
      401,
    );
    expect(
      (
        await mcp(
          handlePlatformMcpRequest,
          "/mcp/platform",
          workspaceRaw,
          "tools/list",
        )
      ).status,
    ).toBe(401);
  });

  it("answers only on platform hosts and accepts the session of an internal role with MFA", async () => {
    const key = await issue(owner, "owner", ["admin:customers:read"]);
    expect(
      (await rest("listCustomers", { key, host: partnerHost })).status,
    ).toBe(404);

    try {
      sessionUser = { userId: owner, mfaSatisfied: true };
      expect((await rest("listCustomers")).status).toBe(200);
      sessionUser = { userId: owner, mfaSatisfied: false };
      expect((await rest("listCustomers")).status).toBe(403);
      sessionUser = { userId: ids.userA, mfaSatisfied: true };
      expect((await rest("listCustomers")).status).toBe(403);
    } finally {
      sessionUser = null;
    }
  });

  it("lists and calls the platform MCP tools by scope and refuses revoked keys and lost roles", async () => {
    const full = await issue(owner, "owner", [
      "admin:customers:read",
      "admin:operations:read",
    ]);
    const tools = await mcp(
      handlePlatformMcpRequest,
      "/mcp/platform",
      full,
      "tools/list",
    );
    expect(
      tools.body.result.tools.map((t: { name: string }) => t.name).sort(),
    ).toEqual([
      "get_customer_summary",
      "get_platform_health",
      "list_customers",
      "list_failed_jobs",
    ]);
    const called = await mcp(
      handlePlatformMcpRequest,
      "/mcp/platform",
      full,
      "tools/call",
      {
        name: "get_customer_summary",
        arguments: { customerId: ids.organizationA },
      },
    );
    expect(called.body.result.structuredContent.id).toBe(ids.organizationA);

    const opsOnly = await issue(support, "support", ["admin:operations:read"]);
    const opsTools = await mcp(
      handlePlatformMcpRequest,
      "/mcp/platform",
      opsOnly,
      "tools/list",
    );
    expect(
      opsTools.body.result.tools.map((t: { name: string }) => t.name).sort(),
    ).toEqual(["get_platform_health", "list_failed_jobs"]);

    // Losing the internal role invalidates the key at once.
    await admin.$executeRawUnsafe(
      `update public.platform_admin_members set status = 'inactive' where user_id = '${support}'`,
    );
    try {
      expect((await rest("getHealth", { key: opsOnly })).status).toBe(401);
    } finally {
      await admin.$executeRawUnsafe(
        `update public.platform_admin_members set status = 'active' where user_id = '${support}'`,
      );
    }

    // A revoked key is refused.
    const keyRow = await admin.platformApiKey.findFirstOrThrow({
      where: { userId: owner },
      orderBy: { createdAt: "desc" },
    });
    // Revoking also needs the second factor (F6a).
    await expect(
      withPlatformContext(prisma, { userId: owner, keyId: null }, (tx) =>
        revokePlatformApiKey(tx, { userId: owner, role: "owner" }, keyRow.id, {
          mfaVerified: false,
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect((await rest("listCustomers", { key: full })).status).toBe(200);
    await withPlatformContext(prisma, { userId: owner, keyId: null }, (tx) =>
      revokePlatformApiKey(
        tx,
        { userId: owner, role: "owner" },
        keyRow.id,
        mfa,
      ),
    );
    expect((await rest("listCustomers", { key: full })).status).toBe(401);
  });
});
