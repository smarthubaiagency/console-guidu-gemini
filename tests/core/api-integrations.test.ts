import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { API_ROUTES } from "@/core/api/contracts";
import { type ApiDeps, handleApiRoute } from "@/core/api/handler";
import { RATE_LIMIT_QUOTAS } from "@/core/api/limits";
import { loadAllowedScopes, loadApiPolicy } from "@/core/api/policy";
import * as resources from "@/core/api/resources";
import {
  platformApiView,
  platformKeyUsage,
  saveApiSwitches,
  savePlanScopes,
  workspaceKeyUsage,
} from "@/core/api/settings";
import {
  API_KEY_PREFIX,
  createApiKey,
  hashApiKey,
} from "@/core/credentials/api-keys";
import {
  googleAppView,
  saveGoogleApp,
  saveGoogleScopes,
} from "@/core/integrations/google/apps";
import {
  completeGoogleConnection,
  disconnectGoogle,
  googleWorkspaceView,
  startGoogleConnection,
} from "@/core/integrations/google/connection";
import {
  createFakeGoogleProvider,
  fakeCode,
  type GoogleOAuthProvider,
  scopeParameter,
} from "@/core/integrations/google/provider";
import { verifyGoogleState } from "@/core/integrations/google/state";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF6b: the API policy of the plan (limits per minute and scopes), the
 * emergency switches, the usage per key, and the Google integration (the
 * apps of the platform and of the partner, the scopes in cascade and the
 * workspace's connection through the fake provider).
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const HOUSE = "00000000-0000-4000-8000-000000000000";
const PARTNER = "bcf6b000-0000-4000-8000-000000000001";
const PLAN = "bcf6b000-0000-4000-8000-0000000000a1";
const PLAN_KEY = "cf6b-plano";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const PLATFORM_SUPPORT = "d0000000-0000-4000-8000-000000000007";
const APP_URL = "http://localhost:3000";
const PLATFORM_SECRET = "GOCSPX-plataforma-0123456789";
const PARTNER_SECRET = "GOCSPX-parceiro-9876543210";

describeDatabase("CF6b: API and integrations", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const keys: string[] = [];
  const ownerB: RequestContext = { ...contextB, principalType: "user" };
  const ownerA: RequestContext = { ...contextA, principalType: "user" };
  const viewerA: RequestContext = {
    userId: ids.userMultiOrg,
    workspaceId: ids.workspaceA,
    organizationId: ids.organizationA,
    principalType: "user",
  };
  const platform = { userId: PLATFORM_OWNER, platformRole: "owner" } as const;
  const support = {
    userId: PLATFORM_SUPPORT,
    platformRole: "support",
  } as const;

  const inPlatform = <T>(
    userId: string,
    op: (tx: ContextTransaction) => Promise<T>,
  ) => withIdentityContext(prisma, userId, op);
  const inPartner = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, ids.userA, op, { partnerId: PARTNER });
  const messageKey = (err: unknown) =>
    err instanceof AppError ? err.messageKey : String(err);

  async function createKey(
    scopes: string[],
  ): Promise<{ raw: string; id: string }> {
    const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
    const id = randomUUID();
    await admin.$executeRawUnsafe(
      `insert into public.api_keys
         (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${id}', '${ids.organizationB}', '${ids.workspaceB}', '${ids.userB}', 'CF6b',
               '${raw.slice(0, 16)}', '${hashApiKey(raw)}', $1::text[], now() + interval '1 day')`,
      scopes,
    );
    keys.push(id);
    return { raw, id };
  }

  const deps = (switches = { api: true, mcp: true }): ApiDeps => ({
    prisma,
    redis: null,
    session: async () => {
      throw new Error("no session in this test");
    },
    apiSwitches: async () => switches,
  });

  async function call(
    route: "getWorkspace" | "listWorkspaceMembers",
    key: string,
    switches?: { api: boolean; mcp: boolean },
  ) {
    const headers = new Headers({
      host: "localhost:3000",
      authorization: `Bearer ${key}`,
    });
    const path = API_ROUTES[route].path.replace("{id}", ids.workspaceB);
    const d = deps(switches);
    const response = await handleApiRoute(
      new Request(`${APP_URL}/api/v1${path}`, { headers }),
      API_ROUTES[route],
      { id: ids.workspaceB },
      d,
      (c) => resources[route](d.prisma, c),
    );
    return { status: response.status, body: await response.json() };
  }

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.settings where key like 'api.%' or key like 'integrations.%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.quota_ceilings where quota_key like 'core.api_%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.workspace_google_connections where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await admin.$executeRawUnsafe(`delete from public.google_oauth_apps`);
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${HOUSE}' where id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.subscriptions where organization_id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.plan_versions where plan_id = '${PLAN}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.plans where id = '${PLAN}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.api_keys where name = 'CF6b' or name like 'CF6b %'`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("APP_URL", APP_URL);
    vi.stubEnv("GOOGLE_OAUTH_PROVIDER", "fake");
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status)
       values ('${PLATFORM_SUPPORT}', 'support', 'active')
       on conflict (user_id) do update set role = 'support', status = 'active'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.plans (id, key, name) values ('${PLAN}', '${PLAN_KEY}', 'Plano CF6b')`,
    );
    const [version] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into public.plan_versions
       (plan_id, version, module_keys, min_price_cents, min_platform_share_cents,
        partner_base_price_cents, limits)
       values ('${PLAN}', 1, '{}'::text[], 0, 0, 1000, $1::jsonb) returning id`,
      JSON.stringify({ [RATE_LIMIT_QUOTAS.key]: 3 }),
    );
    await admin.$executeRawUnsafe(
      `insert into public.subscriptions
       (partner_id, organization_id, plan_version_id, mode, payer, billing_interval,
        amount_cents, status)
       values ('${HOUSE}', '${ids.organizationB}', '${version!.id}', 'partner_pays', 'partner',
               'monthly', 1000, 'active')`,
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("takes the limits from the plan, capped by the ceiling, the environment as default", async () => {
    await admin.$executeRawUnsafe(
      `insert into public.quota_ceilings (quota_key, ceiling) values ('${RATE_LIMIT_QUOTAS.workspace}', 200)`,
    );
    const policy = await withContext(prisma, ownerB, (tx) =>
      loadApiPolicy(tx, ownerB, {}),
    );
    expect(policy.planKey).toBe(PLAN_KEY);
    expect(policy.limits).toEqual({ key: 3, user: 120, workspace: 200 });
    expect(policy.detail.key.source).toBe("plan");
    expect(policy.detail.workspace).toEqual({
      value: 200,
      source: "default",
      ceiling: 200,
    });
    // A company without a plan keeps the environment's default.
    const legacy = await withContext(prisma, ownerA, (tx) =>
      loadApiPolicy(tx, ownerA, { API_RATE_LIMIT_PER_KEY: "9" }),
    );
    expect(legacy.planKey).toBeNull();
    expect(legacy.limits.key).toBe(9);
  });

  it("keeps the scopes of the plan: key creation, REST and MCP", async () => {
    // Support reads but does not save; the owner saves.
    await expect(
      inPlatform(PLATFORM_SUPPORT, (tx) =>
        savePlanScopes(tx, support, { [PLAN_KEY]: ["workspace:read"] }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await inPlatform(PLATFORM_OWNER, (tx) =>
      savePlanScopes(tx, platform, {
        [PLAN_KEY]: ["workspace:read", "modules:read"],
      }),
    );
    await expect(
      inPlatform(PLATFORM_OWNER, (tx) =>
        savePlanScopes(tx, platform, { "nao-existe": ["workspace:read"] }),
      ),
    ).rejects.toSatisfy(
      (e) => messageKey(e) === "apiSettings.errors.unknownPlan",
    );
    const view = await inPlatform(PLATFORM_OWNER, (tx) =>
      platformApiView(tx, platform),
    );
    expect(view.plans.find((p) => p.planKey === PLAN_KEY)).toMatchObject({
      custom: true,
      scopes: ["workspace:read", "modules:read"],
    });
    expect(
      await withContext(prisma, ownerB, (tx) => loadAllowedScopes(tx, ownerB)),
    ).toEqual(["workspace:read", "modules:read"]);
    // The company without a plan keeps every scope.
    expect(
      (await withContext(prisma, ownerA, (tx) => loadAllowedScopes(tx, ownerA)))
        .length,
    ).toBeGreaterThan(5);

    // Creating a key with a scope outside the plan is refused.
    await expect(
      withContext(prisma, ownerB, (tx) =>
        createApiKey(tx, ownerB, {
          name: "CF6b fora",
          scopes: ["workspace:read", "members:read"],
        }),
      ),
    ).rejects.toSatisfy((e) => messageKey(e) === "mcp.errors.scopeNotInPlan");
    const created = await withContext(prisma, ownerB, (tx) =>
      createApiKey(tx, ownerB, {
        name: "CF6b dentro",
        scopes: ["workspace:read"],
      }),
    );
    keys.push(created.apiKey.id);

    // An old key keeps working with what the plan still allows.
    const { raw } = await createKey(["workspace:read", "members:read"]);
    expect((await call("getWorkspace", raw)).status).toBe(200);
    const denied = await call("listWorkspaceMembers", raw);
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toBe(
      "This key does not have the members:read scope.",
    );

    // The MCP lists only the tools of the scopes the plan still allows.
    const mcp = await handleMcpWorkspaceRequest(
      new Request("http://localhost:3000/mcp/workspace", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          authorization: `Bearer ${raw}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      }),
      deps(),
    );
    expect(mcp.status).toBe(200);
    const names = (
      (await mcp.json()) as { result: { tools: { name: string }[] } }
    ).result.tools
      .map((tool) => tool.name)
      .sort();
    expect(names).toEqual(["get_workspace", "get_workspace_overview"]);
  });

  it("limits a key by its plan and counts its calls and errors per day", async () => {
    const { raw, id } = await createKey(["workspace:read"]);
    expect((await call("getWorkspace", raw)).status).toBe(200);
    expect((await call("getWorkspace", raw)).status).toBe(200);
    const third = await call("getWorkspace", raw);
    expect(third.status).toBe(200);
    const limited = await call("getWorkspace", raw);
    expect(limited.status).toBe(429);
    expect((await call("listWorkspaceMembers", raw)).status).toBe(403);

    const rows = await admin.$queryRawUnsafe<
      { surface: string; calls: number; errors: number }[]
    >(
      `select surface, calls, errors from public.api_key_usage_daily where api_key_id = '${id}'`,
    );
    expect(rows).toEqual([{ surface: "api", calls: 5, errors: 2 }]);

    const mine = await withContext(prisma, ownerB, (tx) =>
      workspaceKeyUsage(tx, ownerB),
    );
    const row = mine.keys.find((k) => k.apiKeyId === id);
    expect(row).toMatchObject({ calls: 5, errors: 2, mcpCalls: 0 });
    expect(mine.byDay[0]?.calls).toBeGreaterThanOrEqual(5);

    const all = await inPlatform(PLATFORM_SUPPORT, (tx) =>
      platformKeyUsage(tx, support),
    );
    expect(all.keys.find((k) => k.apiKeyId === id)).toMatchObject({
      workspaceName: "Workspace B",
      organizationName: "Organization B",
      calls: 5,
    });
    // Another workspace's owner sees nothing of these keys.
    const other = await withContext(prisma, ownerA, (tx) =>
      workspaceKeyUsage(tx, ownerA),
    );
    expect(other.keys.some((k) => k.apiKeyId === id)).toBe(false);
  });

  it("answers 503 in English while the platform turns the API or the MCP off", async () => {
    const { raw } = await createKey(["workspace:read"]);
    const off = await call("getWorkspace", raw, { api: false, mcp: true });
    expect(off.status).toBe(503);
    expect(off.body.error).toMatchObject({
      code: "service_disabled",
      message: "The GUIDU API is turned off. Try again later.",
    });
    const mcp = await handleMcpWorkspaceRequest(
      new Request("http://localhost:3000/mcp/workspace", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${raw}` },
        body: "{}",
      }),
      deps({ api: true, mcp: false }),
    );
    expect(mcp.status).toBe(503);

    // The switches live in the cascade: off is stored, on is the default.
    await expect(
      inPlatform(PLATFORM_SUPPORT, (tx) =>
        saveApiSwitches(tx, support, { api: false, mcp: true }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await inPlatform(PLATFORM_OWNER, (tx) =>
      saveApiSwitches(tx, platform, { api: false, mcp: true }),
    );
    let view = await inPlatform(PLATFORM_OWNER, (tx) =>
      platformApiView(tx, platform),
    );
    expect(view.switches).toEqual({ api: false, mcp: true });
    await inPlatform(PLATFORM_OWNER, (tx) =>
      saveApiSwitches(tx, platform, { api: true, mcp: true }),
    );
    view = await inPlatform(PLATFORM_OWNER, (tx) =>
      platformApiView(tx, platform),
    );
    expect(view.switches).toEqual({ api: true, mcp: true });
    const audits = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from public.audit_events
       where action = 'platform.settings.save' and metadata -> 'fields' ? 'api.rest_enabled'
         and occurred_at > now() - interval '1 minute'`,
    );
    expect(Number(audits[0]?.n)).toBeGreaterThanOrEqual(2);
  });

  it("keeps the Google apps' secrets encrypted and narrows the scopes in cascade", async () => {
    const owner = {
      level: "platform",
      userId: PLATFORM_OWNER,
      platformRole: "owner",
    } as const;
    await expect(
      inPlatform(PLATFORM_OWNER, (tx) =>
        saveGoogleApp(tx, owner, {
          clientId: "plataforma.apps.googleusercontent.com",
          clientSecret: "",
          verificationStatus: "testing",
        }),
      ),
    ).rejects.toSatisfy(
      (e) => messageKey(e) === "integrations.google.errors.secretRequired",
    );
    await inPlatform(PLATFORM_OWNER, (tx) =>
      saveGoogleApp(tx, owner, {
        clientId: "plataforma.apps.googleusercontent.com",
        clientSecret: PLATFORM_SECRET,
        verificationStatus: "in_review",
      }),
    );
    // Saving without the secret keeps it.
    await inPlatform(PLATFORM_OWNER, (tx) =>
      saveGoogleApp(tx, owner, {
        clientId: "plataforma.apps.googleusercontent.com",
        clientSecret: "",
        verificationStatus: "verified",
      }),
    );
    const view = await inPlatform(PLATFORM_OWNER, (tx) =>
      googleAppView(tx, owner),
    );
    expect(view.app).toMatchObject({
      clientId: "plataforma.apps.googleusercontent.com",
      verificationStatus: "verified",
    });
    expect(view.app?.secretMasked).not.toContain("plataforma-0123");
    expect(view.redirectUri).toBe(
      `${APP_URL}/api/integrations/google/callback`,
    );
    expect(JSON.stringify(view)).not.toContain(PLATFORM_SECRET);
    const [stored] = await admin.$queryRawUnsafe<
      { client_secret_encrypted: string }[]
    >(
      `select client_secret_encrypted from public.google_oauth_apps where partner_id is null`,
    );
    expect(stored?.client_secret_encrypted).not.toContain(PLATFORM_SECRET);
    const audit = await admin.$queryRawUnsafe<{ metadata: unknown }[]>(
      `select metadata from public.audit_events where action = 'platform.google_app.save'
       order by occurred_at desc limit 1`,
    );
    expect(JSON.stringify(audit[0]?.metadata)).not.toContain(PLATFORM_SECRET);

    // The platform offers two scopes; the partner narrows to one.
    await inPlatform(PLATFORM_OWNER, (tx) =>
      saveGoogleScopes(tx, owner, ["spreadsheets", "calendar.events"]),
    );
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${PARTNER}', 'agencia-cf6b', 'Agência CF6b')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${PARTNER}', '${ids.userA}', 'owner@cf6b.test', 'partner_owner')`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${PARTNER}' where id = '${ids.organizationB}'`,
    );
    const partner = {
      level: "partner",
      userId: ids.userA,
      partnerId: PARTNER,
      partnerRole: "partner_owner",
    } as const;
    await expect(
      inPartner((tx) => saveGoogleScopes(tx, partner, ["drive.file"])),
    ).rejects.toSatisfy(
      (e) => messageKey(e) === "integrations.google.errors.notOffered",
    );
    await inPartner((tx) => saveGoogleScopes(tx, partner, ["spreadsheets"]));
    const partnerView = await inPartner((tx) => googleAppView(tx, partner));
    expect(partnerView.offeredScopes).toEqual([
      "spreadsheets",
      "calendar.events",
    ]);
    expect(partnerView.scopes).toEqual(["spreadsheets"]);
    expect(partnerView.app).toBeNull();
    const workspaceB = await withContext(prisma, ownerB, (tx) =>
      googleWorkspaceView(tx, ownerB),
    );
    expect(workspaceB.scopes).toEqual(["spreadsheets"]);
    expect(workspaceB.app?.source).toBe("platform");

    // The partner's own app takes over for its customers.
    await inPartner((tx) =>
      saveGoogleApp(tx, partner, {
        clientId: "parceiro.apps.googleusercontent.com",
        clientSecret: PARTNER_SECRET,
        verificationStatus: "testing",
      }),
    );
    const afterPartner = await withContext(prisma, ownerB, (tx) =>
      googleWorkspaceView(tx, ownerB),
    );
    expect(afterPartner.app).toEqual({
      source: "partner",
      verificationStatus: "testing",
    });
    // Workspace A (house) stays on the platform's app, with the platform's scopes.
    const workspaceA = await withContext(prisma, ownerA, (tx) =>
      googleWorkspaceView(tx, ownerA),
    );
    expect(workspaceA.app?.source).toBe("platform");
    expect(workspaceA.scopes).toEqual(["spreadsheets", "calendar.events"]);
  });

  it("connects and disconnects the workspace's Google account (fake provider)", async () => {
    const revoked: string[] = [];
    const fake = createFakeGoogleProvider(APP_URL);
    const provider: GoogleOAuthProvider = {
      ...fake,
      revoke: async (token) => {
        revoked.push(token);
      },
    };

    // A viewer never starts a connection.
    await expect(
      withContext(prisma, viewerA, (tx) =>
        startGoogleConnection(
          tx,
          viewerA,
          { workspaceSlug: "workspace-a", returnOrigin: APP_URL },
          provider,
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(
      (
        await withContext(prisma, viewerA, (tx) =>
          googleWorkspaceView(tx, viewerA),
        )
      ).canManage,
    ).toBe(false);

    const start = await withContext(prisma, ownerB, (tx) =>
      startGoogleConnection(
        tx,
        ownerB,
        { workspaceSlug: "workspace-b", returnOrigin: APP_URL },
        provider,
      ),
    );
    const url = new URL(start.url);
    expect(url.pathname).toBe("/api/integrations/google/fake-consent");
    expect(url.searchParams.get("client_id")).toBe(
      "parceiro.apps.googleusercontent.com",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${APP_URL}/api/integrations/google/callback`,
    );
    const state = verifyGoogleState(url.searchParams.get("state"));
    expect(state).toMatchObject({
      workspaceId: ids.workspaceB,
      userId: ids.userB,
      nonce: start.nonce,
    });

    // Google grants more than offered: only the offered scope stays.
    const summary = await completeGoogleConnection(
      prisma,
      ownerB,
      {
        code: fakeCode(scopeParameter(["spreadsheets", "drive.file"])),
        verifier: start.verifier,
        appId: state!.appId,
      },
      provider,
    );
    expect(summary).toMatchObject({
      email: "conta.google@example.com",
      scopes: ["spreadsheets"],
      appSource: "partner",
    });
    const view = await withContext(prisma, ownerB, (tx) =>
      googleWorkspaceView(tx, ownerB),
    );
    expect(view.connection).toMatchObject({
      email: "conta.google@example.com",
      scopes: ["spreadsheets"],
    });
    const [tokens] = await admin.$queryRawUnsafe<
      { access_token_encrypted: string; refresh_token_encrypted: string }[]
    >(
      `select access_token_encrypted, refresh_token_encrypted
       from public.workspace_google_connections where workspace_id = '${ids.workspaceB}'`,
    );
    expect(tokens?.access_token_encrypted).not.toContain("fake-access");
    expect(tokens?.refresh_token_encrypted).not.toContain("fake-refresh");

    // A different app than the one that started is refused.
    await expect(
      completeGoogleConnection(
        prisma,
        ownerB,
        { code: "fake.x", verifier: "v", appId: randomUUID() },
        provider,
      ),
    ).rejects.toSatisfy(
      (e) => messageKey(e) === "integrations.google.errors.appChanged",
    );

    expect(await disconnectGoogle(prisma, ownerB, provider)).toBe(true);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatch(/^fake-refresh-/);
    expect(
      (
        await withContext(prisma, ownerB, (tx) =>
          googleWorkspaceView(tx, ownerB),
        )
      ).connection,
    ).toBeNull();
    expect(await disconnectGoogle(prisma, ownerB, provider)).toBe(false);
    const actions = await admin.$queryRawUnsafe<{ action: string }[]>(
      `select action from public.audit_events
       where workspace_id = '${ids.workspaceB}' and action like 'workspace.google.%'
         and occurred_at > now() - interval '1 minute'`,
    );
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "workspace.google.connect_start",
        "workspace.google.connect",
        "workspace.google.disconnect",
      ]),
    );
  });
});
