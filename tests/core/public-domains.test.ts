import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addPartnerPublicDomain,
  choosePublicDomain,
  publicDomainChoice,
  recordPartnerPublicDomainCheck,
  removePartnerPublicDomain,
  workspacePublicAddresses,
} from "@/core/domains/public-service";
import {
  invalidateDomainCheck,
  isServedHost,
  resolvePublicHost,
} from "@/core/domains/runtime";
import {
  addWorkspaceDomain,
  recordWorkspaceDomainCheck,
  removeWorkspaceDomain,
  type PartnerDomainActor,
  type WorkspaceDomainActor,
} from "@/core/domains/service";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { type RequestContext, withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const HOUSE = "00000000-0000-4000-8000-000000000000";
const PARTNER = "b9c00000-0000-4000-8000-000000000001";
const PLAN = "c2c00000-0000-4000-8000-0000000000a1";
const partnerAdmin = "d0000000-0000-4000-8000-000000000006";
const partnerSupport = "d0000000-0000-4000-8000-000000000004";
const BASE = "cartao.agencia-cf2c.test";

const hasKey = (messageKey: string) => (e: unknown) =>
  e instanceof AppError && e.messageKey === messageKey;

describeDatabase("CF2c: default public domains", requiredVars, () => {
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
    partnerId = PARTNER,
  ): PartnerDomainActor => ({ userId, partnerId, partnerRole });

  const ownerB: WorkspaceDomainActor = {
    kind: "workspace",
    userId: ids.userB,
    ctx: contextB,
  };

  const addresses = (ctx: RequestContext, slug: string) =>
    withContext(prisma, ctx, (tx) => workspacePublicAddresses(tx, slug));

  async function served(host: string) {
    await invalidateDomainCheck(host);
    return isServedHost(prisma, host);
  }

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

  beforeAll(async () => {
    vi.stubEnv("CUSTOM_DOMAIN_CNAME_TARGET", "proxy.guidu.test");
    vi.stubEnv("PARTNER_SUBDOMAIN_BASE", "guidu.test");
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${PARTNER}', 'agencia-cf2c-int', 'Agência CF2c')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
       ('${PARTNER}', '${partnerAdmin}', 'admin@cf2c-int.test', 'partner_admin'),
       ('${PARTNER}', '${partnerSupport}', 'sup@cf2c-int.test', 'partner_support')`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${PARTNER}' where id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.plans (id, key, name) values ('${PLAN}', 'teste-cf2c', 'Teste CF2c')`,
    );
    const [row] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into public.plan_versions
       (plan_id, version, module_keys, min_price_cents, min_platform_share_cents,
        partner_base_price_cents, limits)
       values ('${PLAN}', 1, '{}'::text[], 0, 0, 1000, '{"core.public_domains": 1}'::jsonb)
       returning id`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.subscriptions
       (partner_id, organization_id, plan_version_id, mode, payer, billing_interval,
        amount_cents, status)
       values ('${PARTNER}', '${ids.organizationB}', '${row!.id}', 'partner_pays', 'partner',
               'monthly', 1000, 'active')`,
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("gives every workspace a default subdomain per type, outside the quota", async () => {
    expect(await addresses(contextB, "workspace-b")).toEqual([
      {
        routeType: "profile",
        base: "mobio.pro",
        source: "platform",
        host: "workspace-b.mobio.pro",
      },
      {
        routeType: "quiz",
        base: "quiz.mobio.pro",
        source: "platform",
        host: "workspace-b.quiz.mobio.pro",
      },
      {
        routeType: "page",
        base: "mobio.page",
        source: "platform",
        host: "workspace-b.mobio.page",
      },
    ]);
    expect(await resolvePublicHost(prisma, "workspace-b.mobio.pro")).toEqual({
      kind: "default",
      host: "workspace-b.mobio.pro",
      routeType: "profile",
      partnerId: null,
      workspaceId: ids.workspaceB,
      organizationId: ids.organizationB,
      workspaceSlug: "workspace-b",
    });
    expect(await resolvePublicHost(prisma, "quiz.mobio.pro")).toMatchObject({
      kind: "base",
      routeType: "quiz",
    });
    for (const host of [
      "nao-existe.mobio.pro",
      "www.mobio.pro",
      "a.workspace-b.mobio.pro",
      "workspace-b.outro.test",
    ]) {
      expect(await resolvePublicHost(prisma, host)).toBeNull();
    }
    expect(await served("workspace-b.quiz.mobio.pro")).toBe(true);
    expect(await served("nao-existe.mobio.pro")).toBe(false);

    // An own domain cannot sit under a platform default domain.
    await expect(
      withContext(prisma, contextB, (tx) =>
        addWorkspaceDomain(tx, ownerB, contextB, "loja.mobio.pro"),
      ),
    ).rejects.toSatisfy(hasKey("domains.errors.platformDomain"));
  });

  it("lets the partner replace a default domain for its customers only", async () => {
    const actor = partnerActor(partnerAdmin, "partner_admin");
    const started = new Date().toISOString();

    for (const [input, key] of [
      [{ routeType: "profile", host: "cartao.mobio.pro" }, "platformDomain"],
      [{ routeType: "profile", host: "mobio.pro" }, "platformDomain"],
      [{ routeType: "profile", host: "guidu.test" }, "platformDomain"],
      [{ routeType: "blog", host: BASE }, "invalidRouteType"],
      [{ routeType: "profile", host: "semponto" }, "invalidBaseDomain"],
    ] as const) {
      await expect(
        asPartner(partnerAdmin, (tx) =>
          addPartnerPublicDomain(tx, actor, input),
        ),
      ).rejects.toSatisfy(hasKey(`domains.errors.${key}`));
    }
    await expect(
      withIdentityContext(
        prisma,
        partnerAdmin,
        (tx) =>
          addPartnerPublicDomain(
            tx,
            partnerActor(partnerAdmin, "partner_owner", HOUSE),
            { routeType: "profile", host: "casa.agencia-cf2c.test" },
          ),
        { partnerId: HOUSE },
      ),
    ).rejects.toSatisfy(hasKey("domains.errors.housePartner"));
    await expect(
      asPartner(partnerSupport, (tx) =>
        addPartnerPublicDomain(
          tx,
          partnerActor(partnerSupport, "partner_support"),
          { routeType: "profile", host: BASE },
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const base = await asPartner(partnerAdmin, (tx) =>
      addPartnerPublicDomain(tx, actor, {
        routeType: "profile",
        host: `https://*.${BASE.toUpperCase()}/`,
      }),
    );
    expect(base).toMatchObject({ host: BASE, routeType: "profile" });
    await expect(
      asPartner(partnerAdmin, (tx) =>
        addPartnerPublicDomain(tx, actor, {
          routeType: "profile",
          host: "outro.agencia-cf2c.test",
        }),
      ),
    ).rejects.toSatisfy(hasKey("domains.errors.baseExists"));

    // Pending: nothing changes yet.
    expect((await addresses(contextB, "workspace-b"))[0]).toMatchObject({
      source: "platform",
      host: "workspace-b.mobio.pro",
    });
    expect(await resolvePublicHost(prisma, `workspace-b.${BASE}`)).toBeNull();

    // A failed check keeps it pending; a good one activates it.
    await asPartner(partnerAdmin, (tx) =>
      recordPartnerPublicDomainCheck(tx, actor, base.id, {
        status: "pending",
        lastError: "wildcard_pending",
      }),
    );
    await asPartner(partnerAdmin, (tx) =>
      recordPartnerPublicDomainCheck(tx, actor, base.id, {
        status: "active",
        lastError: null,
      }),
    );

    expect((await addresses(contextB, "workspace-b"))[0]).toEqual({
      routeType: "profile",
      base: BASE,
      source: "partner",
      host: `workspace-b.${BASE}`,
    });
    // The house customer keeps the platform domain.
    expect((await addresses(contextA, "workspace-a"))[0]).toMatchObject({
      source: "platform",
      host: "workspace-a.mobio.pro",
    });

    expect(
      await resolvePublicHost(prisma, `Workspace-B.${BASE}`),
    ).toMatchObject({
      kind: "default",
      routeType: "profile",
      partnerId: PARTNER,
      workspaceId: ids.workspaceB,
    });
    expect(await served(`workspace-b.${BASE}`)).toBe(true);
    // Replaced: the platform profile domain no longer serves workspace B…
    expect(await resolvePublicHost(prisma, "workspace-b.mobio.pro")).toBeNull();
    expect(await served("workspace-b.mobio.pro")).toBe(false);
    // …the other types still do, and the house customer is not served on
    // the partner's domain.
    expect(
      await resolvePublicHost(prisma, "workspace-b.quiz.mobio.pro"),
    ).toMatchObject({ kind: "default", routeType: "quiz" });
    expect(await resolvePublicHost(prisma, `workspace-a.${BASE}`)).toBeNull();
    expect(
      await resolvePublicHost(prisma, "workspace-a.mobio.pro"),
    ).toMatchObject({ kind: "default", workspaceId: ids.workspaceA });

    // No own domain under the partner's default domain.
    await expect(
      withContext(prisma, contextB, (tx) =>
        addWorkspaceDomain(tx, ownerB, contextB, `loja.${BASE}`),
      ),
    ).rejects.toSatisfy(hasKey("domains.errors.taken"));

    await asPartner(partnerAdmin, (tx) =>
      removePartnerPublicDomain(tx, actor, base.id),
    );
    expect((await addresses(contextB, "workspace-b"))[0]).toMatchObject({
      source: "platform",
      host: "workspace-b.mobio.pro",
    });
    expect(
      await resolvePublicHost(prisma, "workspace-b.mobio.pro"),
    ).toMatchObject({ kind: "default" });

    const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
      `select count(*) from public.audit_events where action like 'partner.public_domain.%' and resource_id = '${PARTNER}' and occurred_at >= '${started}'`,
    );
    expect(Number(count)).toBe(3);
  });

  it("lets each tool choose an active own domain, falling back to the default", async () => {
    const target = {
      workspaceId: ids.workspaceB,
      workspaceSlug: "workspace-b",
    };
    const choice = (toolKey = "digital-profile") =>
      withContext(prisma, contextB, (tx) =>
        publicDomainChoice(tx, target, { toolKey, routeType: "profile" }),
      );

    expect(await choice()).toEqual({
      toolKey: "digital-profile",
      routeType: "profile",
      defaultHost: "workspace-b.mobio.pro",
      domains: [],
      domainId: null,
      host: "workspace-b.mobio.pro",
    });
    await expect(
      withContext(prisma, contextB, (tx) =>
        publicDomainChoice(tx, target, {
          toolKey: "Ferramenta",
          routeType: "profile",
        }),
      ),
    ).rejects.toSatisfy(hasKey("domains.errors.invalidTool"));

    const domain = await withContext(prisma, contextB, (tx) =>
      addWorkspaceDomain(tx, ownerB, contextB, "cards.loja-b-cf2c.test"),
    );
    const pick = (domainId: string | null, actor = ownerB) =>
      withContext(prisma, contextB, (tx) =>
        choosePublicDomain(tx, actor, contextB, {
          toolKey: "digital-profile",
          routeType: "profile",
          domainId,
        }),
      );
    await expect(pick(domain.id)).rejects.toSatisfy(
      hasKey("domains.errors.choiceNotActive"),
    );
    await withContext(prisma, contextB, (tx) =>
      recordWorkspaceDomainCheck(tx, ownerB, domain.id, {
        status: "active",
        sslStatus: "none",
        cloudflareHostnameId: null,
        lastError: null,
      }),
    );
    // Another workspace's actor cannot choose for workspace B.
    await expect(
      withContext(prisma, contextA, (tx) =>
        choosePublicDomain(
          tx,
          { kind: "workspace", userId: ids.userA, ctx: contextA },
          contextB,
          { toolKey: "digital-profile", routeType: "profile", domainId: null },
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await pick(domain.id);
    expect(await choice()).toMatchObject({
      domainId: domain.id,
      host: "cards.loja-b-cf2c.test",
      domains: [{ id: domain.id, host: "cards.loja-b-cf2c.test" }],
    });
    // Other tools keep the default.
    expect((await choice("quiz-tool")).host).toBe("workspace-b.mobio.pro");
    expect(
      await resolvePublicHost(prisma, "cards.loja-b-cf2c.test"),
    ).toMatchObject({
      kind: "custom",
      workspaceId: ids.workspaceB,
      tools: [{ toolKey: "digital-profile", routeType: "profile" }],
    });

    // Back to the default, then again to the domain and its removal.
    await pick(null);
    expect((await choice()).domainId).toBeNull();
    await pick(domain.id);
    await withContext(prisma, contextB, (tx) =>
      removeWorkspaceDomain(tx, ownerB, domain.id),
    );
    expect(await choice()).toMatchObject({
      domainId: null,
      host: "workspace-b.mobio.pro",
    });
    const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
      `select count(*) from public.audit_events where action like 'workspace.public_route.%' and resource_id = '${ids.workspaceB}'`,
    );
    expect(Number(count)).toBeGreaterThanOrEqual(3);
  });
});
