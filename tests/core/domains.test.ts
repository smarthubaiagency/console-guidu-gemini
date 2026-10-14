import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addPartnerCustomDomain,
  addWorkspaceDomain,
  listPartnerCustomerWorkspaces,
  recordPartnerDomainCheck,
  recordWorkspaceDomainCheck,
  removePartnerCustomDomain,
  removeWorkspaceDomain,
  setPrimaryWorkspaceDomain,
  workspaceDomainQuota,
  type PartnerDomainActor,
  type WorkspaceDomainActor,
} from "@/core/domains/service";
import {
  invalidateDomainCheck,
  isServedHost,
  resolvePublicDomain,
} from "@/core/domains/runtime";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const HOUSE = "00000000-0000-4000-8000-000000000000";
const PARTNER = "b9000000-0000-4000-8000-000000000001";
const PLAN = "c2b00000-0000-4000-8000-0000000000a1";
/** Platform-seeded identities used as partner members here. */
const partnerAdmin = "d0000000-0000-4000-8000-000000000006";
const partnerSupport = "d0000000-0000-4000-8000-000000000004";

const ACTIVE = {
  status: "active",
  sslStatus: "active",
  cloudflareHostnameId: "cf-1",
  lastError: null,
} as const;

const hasCode = (code: string, messageKey?: string) => (e: unknown) =>
  e instanceof AppError &&
  e.code === code &&
  (messageKey === undefined || e.messageKey === messageKey);

describeDatabase("CF2b: custom domains", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const asPartner = <T>(
    userId: string,
    run: (
      tx: Parameters<Parameters<typeof withIdentityContext<T>>[2]>[0],
    ) => Promise<T>,
  ) => withIdentityContext(prisma, userId, run, { partnerId: PARTNER });

  const partnerActor = (
    userId: string,
    partnerRole: string,
  ): PartnerDomainActor => ({ userId, partnerId: PARTNER, partnerRole });

  const workspaceActor: WorkspaceDomainActor = {
    kind: "workspace",
    userId: ids.userB,
    ctx: contextB,
  };

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.workspace_domains where workspace_id = '${ids.workspaceB}'`,
    );
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
  }

  async function planLimit(limit: number) {
    await admin.$executeRawUnsafe(
      `delete from public.subscriptions where organization_id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.plan_versions where plan_id = '${PLAN}'`,
    );
    const [row] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into public.plan_versions
       (plan_id, version, module_keys, min_price_cents, min_platform_share_cents,
        partner_base_price_cents, limits)
       values ('${PLAN}', 1, '{}'::text[], 0, 0, 1000, $1::jsonb) returning id`,
      JSON.stringify({ "core.public_domains": limit }),
    );
    await admin.$executeRawUnsafe(
      `insert into public.subscriptions
       (partner_id, organization_id, plan_version_id, mode, payer, billing_interval,
        amount_cents, status)
       values ('${PARTNER}', '${ids.organizationB}', '${row!.id}', 'partner_pays', 'partner',
               'monthly', 1000, 'active')`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("CUSTOM_DOMAIN_CNAME_TARGET", "proxy.guidu.test");
    vi.stubEnv("PARTNER_SUBDOMAIN_BASE", "guidu.test");
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${PARTNER}', 'agencia-dominios', 'Agência Domínios')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
       ('${PARTNER}', '${partnerAdmin}', 'admin@dominios.test', 'partner_admin'),
       ('${PARTNER}', '${partnerSupport}', 'sup@dominios.test', 'partner_support')`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${PARTNER}' where id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.plans (id, key, name) values ('${PLAN}', 'teste-cf2b', 'Teste CF2b')`,
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("lets the partner admin add, verify and remove its dashboard domain", async () => {
    const actor = partnerActor(partnerAdmin, "partner_admin");
    const { host } = await asPartner(partnerAdmin, (tx) =>
      addPartnerCustomDomain(tx, actor, "https://Console.Agencia.test/login"),
    );
    expect(host).toBe("console.agencia.test");

    // Platform hosts, platform subdomains and repeated hosts are refused.
    for (const [input, key] of [
      ["localhost.test.guidu.test", "domains.errors.platformDomain"],
      ["proxy.guidu.test", "domains.errors.platformDomain"],
      ["semponto", "domains.errors.invalidDomain"],
      ["console.agencia.test", "domains.errors.taken"],
    ] as const) {
      await expect(
        asPartner(partnerAdmin, (tx) =>
          addPartnerCustomDomain(tx, actor, input),
        ),
      ).rejects.toSatisfy((e) => e instanceof AppError && e.messageKey === key);
    }

    // Support reads, never manages.
    await expect(
      asPartner(partnerSupport, (tx) =>
        addPartnerCustomDomain(
          tx,
          partnerActor(partnerSupport, "partner_support"),
          "outro.agencia.test",
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(await isServedHost(prisma, host)).toBe(false);
    await asPartner(partnerAdmin, (tx) =>
      recordPartnerDomainCheck(tx, actor, host, ACTIVE),
    );
    await invalidateDomainCheck(host);
    expect(await isServedHost(prisma, host)).toBe(true);
    const [row] = await admin.$queryRawUnsafe<
      { status: string; ssl_status: string; verified_at: Date | null }[]
    >(
      `select status, ssl_status, verified_at from public.partner_domains where host = '${host}'`,
    );
    expect(row).toMatchObject({ status: "active", ssl_status: "active" });
    expect(row!.verified_at).not.toBeNull();

    // A failed check later does not take an active domain down.
    await asPartner(partnerAdmin, (tx) =>
      recordPartnerDomainCheck(tx, actor, host, {
        status: "pending",
        sslStatus: "error",
        cloudflareHostnameId: "cf-1",
        lastError: "ssl_error",
      }),
    );
    await invalidateDomainCheck(host);
    expect(await isServedHost(prisma, host)).toBe(true);

    const removed = await asPartner(partnerAdmin, (tx) =>
      removePartnerCustomDomain(tx, actor, host),
    );
    expect(removed.cloudflareHostnameId).toBe("cf-1");
    await invalidateDomainCheck(host);
    expect(await isServedHost(prisma, host)).toBe(false);
  });

  it("keeps public domains within the plan and resolves the active ones", async () => {
    // No plan limit: no public domain.
    await expect(
      withContext(prisma, contextB, (tx) =>
        addWorkspaceDomain(tx, workspaceActor, contextB, "perfil.loja-b.test"),
      ),
    ).rejects.toSatisfy(hasCode("conflict", "apiErrors.quotaExceeded"));

    await planLimit(1);
    const first = await withContext(prisma, contextB, (tx) =>
      addWorkspaceDomain(tx, workspaceActor, contextB, "perfil.loja-b.test"),
    );
    expect(
      await withContext(prisma, contextB, (tx) =>
        workspaceDomainQuota(tx, contextB),
      ),
    ).toEqual({ limit: 1, used: 1 });
    await expect(
      withContext(prisma, contextB, (tx) =>
        addWorkspaceDomain(tx, workspaceActor, contextB, "quiz.loja-b.test"),
      ),
    ).rejects.toSatisfy(hasCode("conflict", "apiErrors.quotaExceeded"));

    // The first active domain becomes the primary one and resolves.
    await withContext(prisma, contextB, (tx) =>
      recordWorkspaceDomainCheck(tx, workspaceActor, first.id, ACTIVE),
    );
    expect(await resolvePublicDomain(prisma, first.host)).toMatchObject({
      workspaceId: ids.workspaceB,
    });
    const [primary] = await admin.$queryRawUnsafe<{ is_primary: boolean }[]>(
      `select is_primary from public.workspace_domains where id = '${first.id}'`,
    );
    expect(primary?.is_primary).toBe(true);

    // The company's partner adds one more when the plan allows.
    await planLimit(2);
    const partner: WorkspaceDomainActor = {
      kind: "partner",
      userId: partnerAdmin,
      partnerId: PARTNER,
      partnerRole: "partner_admin",
    };
    const workspaces = await asPartner(partnerAdmin, (tx) =>
      listPartnerCustomerWorkspaces(tx),
    );
    expect(workspaces.map((w) => w.workspaceId)).toEqual([ids.workspaceB]);
    const second = await asPartner(partnerAdmin, (tx) =>
      addWorkspaceDomain(tx, partner, workspaces[0]!, "quiz.loja-b.test"),
    );
    await expect(
      withContext(prisma, contextB, (tx) =>
        setPrimaryWorkspaceDomain(tx, workspaceActor, second.id),
      ),
    ).rejects.toSatisfy(
      hasCode("invalid_input", "domains.errors.primaryNotActive"),
    );

    // Support of the partner cannot remove; the workspace owner can.
    await expect(
      asPartner(partnerSupport, (tx) =>
        removeWorkspaceDomain(
          tx,
          {
            ...partner,
            userId: partnerSupport,
            partnerRole: "partner_support",
          },
          second.id,
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await withContext(prisma, contextB, (tx) =>
      removeWorkspaceDomain(tx, workspaceActor, second.id),
    );

    const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
      `select count(*) from public.audit_events where action like 'workspace.domain.%' and resource_id = '${ids.workspaceB}'`,
    );
    expect(Number(count)).toBeGreaterThanOrEqual(4);
  });
});
