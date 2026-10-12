import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { API_ROUTES } from "@/core/api/contracts";
import { type ApiCall, type ApiDeps, handleApiRoute } from "@/core/api/handler";
import * as crm from "@/core/api/crm";
import * as portfolio from "@/core/api/portfolio";
import * as resources from "@/core/api/resources";
import { API_KEY_PREFIX, hashApiKey } from "@/core/credentials/api-keys";
import { AccessDeniedError } from "@/core/auth/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const redisUrl = process.env.REDIS_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const otherPartner = "f4a00000-0000-4000-8000-0000000000a1";
const otherHost = "api-f4a.test";

type RouteId = keyof typeof API_ROUTES;
const RUN: Record<
  RouteId,
  (prisma: PrismaClient, call: ApiCall) => Promise<unknown>
> = {
  listMyWorkspaces: resources.listMyWorkspaces,
  getWorkspace: resources.getWorkspace,
  getWorkspaceOverview: resources.getWorkspaceOverview,
  listWorkspaceModules: resources.listWorkspaceModules,
  getWorkspaceUsage: resources.getWorkspaceUsage,
  listWorkspaceExecutions: resources.listWorkspaceExecutions,
  listWorkspaceMembers: resources.listWorkspaceMembers,
  listCrmContacts: crm.listCrmContacts,
  createCrmContact: crm.createCrmContact,
  getCrmContact: crm.getCrmContact,
  updateCrmContact: crm.updateCrmContact,
  searchPortfolioCatalog: portfolio.searchPortfolioCatalog,
  lookupPortfolioCatalog: portfolio.lookupPortfolioCatalog,
  getPortfolioCatalogProduct: portfolio.getPortfolioCatalogProduct,
  searchPortfolioForAgent: portfolio.searchPortfolioForAgent,
  getPortfolioItemForAgent: portfolio.getPortfolioItemForAgent,
  createPortfolioItem: portfolio.createPortfolioItem,
  updatePortfolioItem: portfolio.updatePortfolioItem,
  updatePortfolioVariant: portfolio.updatePortfolioVariant,
};

describeDatabase("F4a: REST API v1", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const redis = redisUrl ? new Redis(redisUrl) : null;
  let sessionUser: string | null = null;
  const deps = (withRedis = true): ApiDeps => ({
    prisma,
    redis: withRedis ? redis : null,
    session: async () => {
      if (!sessionUser) throw new AccessDeniedError("unauthenticated", 401);
      return { userId: sessionUser, mfaSatisfied: true };
    },
  });

  const keys: string[] = [];
  async function createKey(
    scopes: string[],
    user: string = ids.userA,
    workspace: string = ids.workspaceA,
    organization: string = ids.organizationA,
  ): Promise<{ raw: string; id: string }> {
    const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
    const id = randomUUID();
    await admin.$executeRawUnsafe(
      `insert into public.api_keys
         (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${id}', '${organization}', '${workspace}', '${user}', 'F4a',
               '${raw.slice(0, 16)}', '${hashApiKey(raw)}', $1::text[], now() + interval '1 day')`,
      scopes,
    );
    keys.push(id);
    return { raw, id };
  }

  async function call(
    route: RouteId,
    options: Readonly<{
      key?: string;
      id?: string;
      host?: string;
      query?: string;
      withRedis?: boolean;
    }> = {},
  ) {
    const headers = new Headers({ host: options.host ?? "localhost:3000" });
    if (options.key) headers.set("authorization", `Bearer ${options.key}`);
    const path = API_ROUTES[route].path.replace(
      "{id}",
      options.id ?? ids.workspaceA,
    );
    const request = new Request(
      `http://localhost:3000/api/v1${path}${options.query ?? ""}`,
      { headers },
    );
    const d = deps(options.withRedis ?? true);
    const response = await handleApiRoute(
      request,
      API_ROUTES[route],
      { id: options.id ?? ids.workspaceA },
      d,
      (c) => RUN[route](d.prisma, c),
    );
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }

  const ALL_READ = [
    "workspace:read",
    "modules:read",
    "usage:read",
    "executions:read",
    "members:read",
  ];

  beforeAll(async () => {
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${otherPartner}', 'api-f4a', 'Agência API')
       on conflict (id) do nothing`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_domains (host, partner_id, kind, status)
       values ('${otherHost}', '${otherPartner}', 'custom', 'active') on conflict (host) do nothing`,
    );
  });

  afterEach(() => {
    sessionUser = null;
    delete process.env.API_RATE_LIMIT_PER_KEY;
  });

  afterAll(async () => {
    if (keys.length) {
      await admin.$executeRawUnsafe(
        `delete from public.api_keys where id in (${keys.map((k) => `'${k}'`).join(",")})`,
      );
    }
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${otherPartner}'`,
    );
    await redis?.quit();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("serves the core read routes to a key with the scopes (contract)", async () => {
    const { raw } = await createKey(ALL_READ);
    const mine = await call("listMyWorkspaces", { key: raw });
    expect(mine.status).toBe(200);
    expect(mine.body.data).toEqual([
      expect.objectContaining({ id: ids.workspaceA, role: "owner" }),
    ]);
    expect(mine.headers.get("x-request-id")).toBeTruthy();
    expect(mine.headers.get("ratelimit-limit")).toBe("60");

    const workspace = await call("getWorkspace", { key: raw });
    expect(workspace.body.data).toMatchObject({
      id: ids.workspaceA,
      organizationId: ids.organizationA,
    });
    const overview = await call("getWorkspaceOverview", { key: raw });
    expect(overview.status).toBe(200);
    expect(overview.body.data.members).toBeGreaterThan(0);
    expect((await call("listWorkspaceModules", { key: raw })).status).toBe(200);
    expect((await call("getWorkspaceUsage", { key: raw })).status).toBe(200);

    const members = await call("listWorkspaceMembers", {
      key: raw,
      query: "?limit=1",
    });
    expect(members.status).toBe(200);
    expect(members.body.data).toHaveLength(1);
    expect(Object.keys(members.body.data[0]).sort()).toEqual([
      "joinedAt",
      "role",
      "status",
      "userId",
    ]);
    expect(members.body.nextCursor).toEqual(expect.any(String));
    const next = await call("listWorkspaceMembers", {
      key: raw,
      query: `?limit=1&cursor=${members.body.nextCursor}`,
    });
    expect(next.body.data[0].userId).not.toBe(members.body.data[0].userId);

    expect(
      (await call("listWorkspaceExecutions", { key: raw, query: "?limit=500" }))
        .status,
    ).toBe(422);
    expect(
      (
        await call("listWorkspaceExecutions", {
          key: raw,
          query: "?cursor=nope",
        })
      ).status,
    ).toBe(422);
  });

  it("keeps a key in its workspace and scopes (AC01)", async () => {
    const { raw } = await createKey(["workspace:read"]);
    const other = await call("getWorkspace", { key: raw, id: ids.workspaceB });
    expect(other.status).toBe(404);
    expect(other.body.error).toMatchObject({
      code: "not_found",
      requestId: expect.any(String),
    });
    expect(
      (await call("getWorkspace", { key: raw, id: "nao-e-uuid" })).status,
    ).toBe(404);
    const noScope = await call("listWorkspaceMembers", { key: raw });
    expect(noScope.status).toBe(403);
    // The API always answers in English (I5).
    expect(noScope.body.error.message).toBe(
      "This key does not have the members:read scope.",
    );
  });

  it("stops a revoked key and a removed member at the next request (AC03)", async () => {
    const { raw, id } = await createKey(["workspace:read"]);
    expect((await call("getWorkspace", { key: raw })).status).toBe(200);
    await admin.$executeRawUnsafe(
      `update public.api_keys set status = 'revoked', revoked_at = now() where id = '${id}'`,
    );
    const revoked = await call("getWorkspace", { key: raw });
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe("unauthenticated");

    // The viewer of workspace A loses the membership.
    const viewer = await createKey(["workspace:read"], ids.userMultiOrg);
    expect((await call("getWorkspace", { key: viewer.raw })).status).toBe(200);
    await admin.$executeRawUnsafe(
      `update public.workspace_members set status = 'inactive'
       where user_id = '${ids.userMultiOrg}' and workspace_id = '${ids.workspaceA}'`,
    );
    try {
      expect((await call("getWorkspace", { key: viewer.raw })).status).toBe(
        401,
      );
    } finally {
      await admin.$executeRawUnsafe(
        `update public.workspace_members set status = 'active'
         where user_id = '${ids.userMultiOrg}' and workspace_id = '${ids.workspaceA}'`,
      );
    }
  });

  it("accepts a key only on its partner's hosts", async () => {
    const { raw } = await createKey(["workspace:read"]);
    expect(
      (await call("getWorkspace", { key: raw, host: otherHost })).status,
    ).toBe(401);
    expect(
      (await call("getWorkspace", { key: raw, host: "desconhecido.test" }))
        .status,
    ).toBe(404);
    expect((await call("getWorkspace", { key: "Basic abc" })).status).toBe(401);
  });

  it("serves the browser session with the role's permissions", async () => {
    expect((await call("listMyWorkspaces")).status).toBe(401);
    sessionUser = ids.userA;
    const mine = await call("listMyWorkspaces");
    expect(mine.body.data.map((w: { id: string }) => w.id)).toContain(
      ids.workspaceA,
    );
    expect((await call("getWorkspace", { id: ids.workspaceB })).status).toBe(
      404,
    );
    expect((await call("listWorkspaceMembers")).status).toBe(200);
  });

  it.each([
    ["Redis", true],
    ["Postgres (sem Redis)", false],
  ])("limits requests per key with %s (429)", async (_store, withRedis) => {
    if (withRedis && !redis) return;
    // Stay inside one one-minute window.
    const seconds = new Date().getUTCSeconds();
    if (seconds > 54)
      await new Promise((r) => setTimeout(r, (61 - seconds) * 1000));
    process.env.API_RATE_LIMIT_PER_KEY = "3";
    const { raw } = await createKey(["workspace:read"]);
    for (let i = 0; i < 3; i += 1) {
      const ok = await call("getWorkspace", { key: raw, withRedis });
      expect(ok.status).toBe(200);
    }
    const limited = await call("getWorkspace", { key: raw, withRedis });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("ratelimit-remaining")).toBe("0");
  });
});
