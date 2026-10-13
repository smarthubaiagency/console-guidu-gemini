import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCustomerReferral,
  deleteCustomerReferral,
  getCustomerGuid,
  listCustomerGuids,
  updateCustomerGuid,
  updateCustomerReferral,
} from "@/core/ai/customer-guids";
import { ConfigValidationError } from "@/core/ai/templates";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { PartnerRoleKey } from "@/core/permissions/matrix";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { listGuids } from "@/modules/ai-agents/server";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A3c: the partner manages the configuration and the referrals of its
 * customers' GUIDS in `/admin`, never the customer's key, and the customer
 * sees "Alterado por <parceiro> em <data>". Another partner sees nothing.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "c3c00000-0000-4000-8000-000000000001";
const OTHER = "c3c00000-0000-4000-8000-000000000002";
const ORG = "c3c00000-0000-4000-8000-000000000010";
const WS = "c3c00000-0000-4000-8000-000000000011";
const OTHER_ORG = "c3c00000-0000-4000-8000-000000000020";
const OTHER_WS = "c3c00000-0000-4000-8000-000000000021";
const GUID = "c3c00000-0000-4000-8000-0000000000a1";
const OTHER_GUID = "c3c00000-0000-4000-8000-0000000000b1";
const KEY = "c3c00000-0000-4000-8000-0000000000c1";

describeDatabase("A3c: customers' GUIDS in /admin", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const actorOf = (
    userId: string,
    partnerId: string,
    partnerRole: PartnerRoleKey,
  ) => ({ userId, partnerId, partnerRole });
  const owner = actorOf(ids.userA, PARTNER, "partner_owner");
  const support = actorOf(ids.userB, PARTNER, "partner_support");
  const otherOwner = actorOf(ids.userB, OTHER, "partner_owner");
  // The customer's owner, on the partner's host.
  const customer: RequestContext = {
    userId: ids.userB,
    organizationId: ORG,
    workspaceId: WS,
    partnerId: PARTNER,
  };

  const inPartner = <T>(
    actor: { userId: string; partnerId: string },
    op: (tx: ContextTransaction) => Promise<T>,
  ) =>
    withIdentityContext(prisma, actor.userId, op, {
      partnerId: actor.partnerId,
    });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where workspace_id in ('${WS}', '${OTHER_WS}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.organizations where id in ('${ORG}', '${OTHER_ORG}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id in ('${PARTNER}', '${OTHER}')`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values
         ('${PARTNER}', 'agencia-a3c', 'Agência A3c'),
         ('${OTHER}', 'outra-a3c', 'Outra A3c')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
         ('${PARTNER}', '${ids.userA}', 'owner@a3c.test', 'partner_owner'),
         ('${PARTNER}', '${ids.userB}', 'support@a3c.test', 'partner_support'),
         ('${OTHER}', '${ids.userB}', 'owner@outra-a3c.test', 'partner_owner')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organizations (id, name, status, partner_id) values
         ('${ORG}', 'Clínica Sorriso', 'active', '${PARTNER}'),
         ('${OTHER_ORG}', 'Cliente da outra', 'active', '${OTHER}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspaces (id, organization_id, slug, name, status) values
         ('${WS}', '${ORG}', 'clinica-sorriso-a3c', 'Clínica Sorriso', 'active'),
         ('${OTHER_WS}', '${OTHER_ORG}', 'cliente-outra-a3c', 'Cliente da outra', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organization_members (organization_id, user_id, role, status)
       values ('${ORG}', '${ids.userB}', 'owner', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
       values ('${WS}', '${ORG}', '${ids.userB}', 'owner', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${ORG}', '${WS}', 'ai-agents', 'enabled', '${ids.userB}')`,
    );
    const config = (name: string, credentialId: string | null) =>
      JSON.stringify({
        overview: { agent_name: name, system_prompt: "Atenda bem." },
        model: { credential_id: credentialId, model_name: "openai/gpt-4o" },
      });
    await admin.$executeRawUnsafe(
      `insert into public.ai_agents (id, kind, organization_id, workspace_id, config, created_by) values
         ('${GUID}', 'guid', '${ORG}', '${WS}', '${config("Sofia", KEY)}', '${ids.userB}'),
         ('${OTHER_GUID}', 'guid', '${OTHER_ORG}', '${OTHER_WS}', '${config("Bruno", null)}', '${ids.userB}')`,
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("lists only the GUIDS of the partner's customers, with filters", async () => {
    const all = await inPartner(owner, (tx) => listCustomerGuids(tx, owner));
    expect(all.map((g) => g.id)).toEqual([GUID]);
    expect(all[0]).toMatchObject({
      name: "Sofia",
      customerId: ORG,
      customerName: "Clínica Sorriso",
      status: "draft",
      model: "openai/gpt-4o",
      changedByPartner: false,
    });

    const filtered = (filters: Parameters<typeof listCustomerGuids>[2]) =>
      inPartner(support, (tx) => listCustomerGuids(tx, support, filters));
    expect(await filtered({ q: "sorriso" })).toHaveLength(1);
    expect(await filtered({ q: "sofia" })).toHaveLength(1);
    expect(await filtered({ q: "bruno" })).toHaveLength(0);
    expect(await filtered({ status: "active" })).toHaveLength(0);
    // A company of another partner shows nothing, even when asked for.
    expect(await filtered({ customer: OTHER_ORG })).toHaveLength(0);

    await expect(
      inPartner(owner, (tx) => getCustomerGuid(tx, owner, OTHER_GUID)),
    ).rejects.toMatchObject({ code: "not_found" });
    const theirs = await inPartner(otherOwner, (tx) =>
      listCustomerGuids(tx, otherOwner),
    );
    expect(theirs.map((g) => g.id)).toEqual([OTHER_GUID]);
  });

  it("changes the configuration but never the customer's key", async () => {
    const before = await inPartner(owner, (tx) =>
      getCustomerGuid(tx, owner, GUID),
    );

    const key = await inPartner(owner, (tx) =>
      updateCustomerGuid(tx, owner, GUID, {
        status: "paused",
        config: {
          ...before.config,
          model: { ...before.config.model, credential_id: null },
        },
      }),
    ).catch((err: unknown) => err);
    expect(key).toBeInstanceOf(ConfigValidationError);
    expect(
      (key as ConfigValidationError).fieldErrors["model.credential_id"],
    ).toBeDefined();

    // Turning it on needs the minimum fields.
    const incomplete = await inPartner(owner, (tx) =>
      updateCustomerGuid(tx, owner, GUID, {
        status: "active",
        config: before.config,
      }),
    ).catch((err: unknown) => err);
    expect(incomplete).toBeInstanceOf(ConfigValidationError);

    const saved = await inPartner(owner, (tx) =>
      updateCustomerGuid(tx, owner, GUID, {
        status: "paused",
        config: {
          ...before.config,
          overview: { ...before.config.overview, agent_name: "Sofia 2" },
          integration: { tools: ["think"] },
        },
      }),
    );
    expect(saved).toMatchObject({
      name: "Sofia 2",
      status: "draft",
      changedByPartner: true,
    });
    expect(saved.config.model.credential_id).toBe(KEY);
    expect(saved.config.integration.tools).toEqual(["think"]);

    const row = await admin.aiAgent.findUniqueOrThrow({ where: { id: GUID } });
    expect(row.updatedBy).toBe(ids.userA);
    expect(row.updatedByPartnerId).toBe(PARTNER);
    const audit = await admin.auditEvent.findFirst({
      where: { action: "ai.guid.partner_update", resourceId: GUID },
    });
    expect(audit?.metadata).toMatchObject({
      partnerId: PARTNER,
      fields: ["overview.agent_name", "integration.tools"],
    });

    await expect(
      inPartner(support, (tx) =>
        updateCustomerGuid(tx, support, GUID, {
          status: "paused",
          config: saved.config,
        }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      inPartner(otherOwner, (tx) =>
        updateCustomerGuid(tx, otherOwner, GUID, {
          status: "paused",
          config: saved.config,
        }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("shows the customer who changed its GUIDS", async () => {
    const guids = await withContext(prisma, customer, (tx) =>
      listGuids(tx, customer),
    );
    expect(guids[0]).toMatchObject({
      id: GUID,
      name: "Sofia 2",
      updatedByPartnerId: PARTNER,
      updatedByPartnerName: "Agência A3c",
    });
  });

  it("manages the customer's referrals", async () => {
    const created = await inPartner(owner, (tx) =>
      createCustomerReferral(tx, owner, GUID, {
        name: "Dra. Ana",
        referralTag: "Dra-Ana",
        specialties: ["Ortodontia"],
        phone: "+5511999998888",
        city: "Curitiba",
        remote: false,
      }),
    );
    expect(created).toMatchObject({
      referralTag: "dra-ana",
      specialties: ["Ortodontia"],
    });

    const repeated = await inPartner(owner, (tx) =>
      createCustomerReferral(tx, owner, GUID, {
        name: "Outra",
        referralTag: "dra-ana",
        specialties: [],
        phone: "",
        city: "",
        remote: true,
      }),
    ).catch((err: unknown) => err);
    expect(repeated).toBeInstanceOf(ConfigValidationError);
    expect(
      (repeated as ConfigValidationError).fieldErrors.referralTag,
    ).toBeDefined();

    const invalid = await inPartner(owner, (tx) =>
      createCustomerReferral(tx, owner, GUID, {
        name: "",
        referralTag: "com espaço",
        specialties: [],
        phone: "11 9999",
        city: "",
        remote: false,
      }),
    ).catch((err: unknown) => err);
    expect(
      Object.keys((invalid as ConfigValidationError).fieldErrors).sort(),
    ).toEqual(["name", "phone", "referralTag"]);

    const updated = await inPartner(owner, (tx) =>
      updateCustomerReferral(tx, owner, GUID, created.id, {
        name: "Dra. Ana Lima",
        referralTag: "dra-ana",
        specialties: ["Ortodontia"],
        phone: "+5511999998888",
        city: "Curitiba",
        remote: true,
      }),
    );
    expect(updated).toMatchObject({ name: "Dra. Ana Lima", remote: true });
    const audit = await admin.auditEvent.findFirst({
      where: {
        action: "ai.referral.partner_update",
        resourceId: created.id,
      },
    });
    expect(audit?.metadata).toMatchObject({ fields: ["name", "remote"] });

    // The customer sees the partner's referral; support only reads it.
    const detail = await inPartner(support, (tx) =>
      getCustomerGuid(tx, support, GUID),
    );
    expect(detail.referrals.map((r) => r.name)).toEqual(["Dra. Ana Lima"]);
    await expect(
      inPartner(support, (tx) =>
        deleteCustomerReferral(tx, support, GUID, created.id),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      inPartner(otherOwner, (tx) =>
        deleteCustomerReferral(tx, otherOwner, GUID, created.id),
      ),
    ).rejects.toBeInstanceOf(AppError);

    await inPartner(owner, (tx) =>
      deleteCustomerReferral(tx, owner, GUID, created.id),
    );
    expect(
      await admin.aiAgentReferral.count({ where: { workspaceId: WS } }),
    ).toBe(0);
  });
});
