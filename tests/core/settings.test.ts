import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  effectiveSettings,
  saveSettings,
  type SettingsActor,
  settingsView,
} from "@/core/settings/service";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { contextB, contextMultiOrgInA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF1: the settings cascade. The platform offers currencies and sets (and
 * may lock) defaults, the partner adjusts them for its customers and the
 * workspace for itself; a lock or a currency not offered is refused.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "bcf10000-0000-4000-8000-000000000001";
const HOUSE = "00000000-0000-4000-8000-000000000000";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";

describeDatabase("CF1: settings cascade", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const platform: SettingsActor = {
    level: "platform",
    userId: PLATFORM_OWNER,
    platformRole: "owner",
  };
  const partner: SettingsActor = {
    level: "partner",
    userId: ids.userA,
    partnerId: PARTNER,
    partnerRole: "partner_owner",
  };
  const workspaceOwner: RequestContext = { ...contextB, principalType: "user" };
  const workspace: SettingsActor = {
    level: "workspace",
    userId: ids.userB,
    ctx: workspaceOwner,
  };

  const inPlatform = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, PLATFORM_OWNER, op);
  const inPartner = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, ids.userA, op, { partnerId: PARTNER });
  const inWorkspace = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withContext(prisma, workspaceOwner, op);

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.settings where scope = 'platform'
         or workspace_id = '${ids.workspaceB}'`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${HOUSE}'
       where id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name)
       values ('${PARTNER}', 'agencia-cf1', 'Agência CF1')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${PARTNER}', '${ids.userA}', 'owner@cf1.test', 'partner_owner')`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${PARTNER}'
       where id = '${ids.organizationB}'`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("lets the platform offer currencies and lock a default", async () => {
    const view = await inPlatform((tx) =>
      saveSettings(tx, platform, {
        values: {
          "region.currencies": ["BRL", "USD"],
          "region.currency": "USD",
          "region.timezone": "America/Sao_Paulo",
        },
        locks: { "region.timezone": true },
      }),
    );
    expect(view.canEdit).toBe(true);
    expect(view.effective.values["region.currency"]).toBe("USD");
    expect(view.effective.detail["region.timezone"].lockedBy).toBe("platform");
    const audit = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) as count from public.audit_events
       where action = 'platform.settings.save' and actor_user_id = '${PLATFORM_OWNER}'`,
    );
    expect(Number(audit[0]?.count)).toBeGreaterThan(0);
  });

  it("lets the partner adjust what is not locked, within the offered currencies", async () => {
    const view = await inPartner((tx) =>
      saveSettings(tx, partner, { values: { "region.currency": "BRL" } }),
    );
    expect(view.inherited.values["region.currency"]).toBe("USD");
    expect(view.effective.detail["region.currency"]).toMatchObject({
      value: "BRL",
      source: "partner",
    });

    await expect(
      inPartner((tx) =>
        saveSettings(tx, partner, { values: { "region.currency": "EUR" } }),
      ),
    ).rejects.toMatchObject({ messageKey: "settings.errors.currency" });
    await expect(
      inPartner((tx) =>
        saveSettings(tx, partner, { values: { "region.timezone": "UTC" } }),
      ),
    ).rejects.toMatchObject({ messageKey: "settings.errors.locked" });
    await expect(
      inPartner((tx) =>
        saveSettings(tx, partner, {
          values: { "region.currencies": ["BRL"] },
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "settings.errors.unknown" });
  });

  it("gives the workspace its partner's values and lets it set its own", async () => {
    const before = await inWorkspace((tx) => effectiveSettings(tx));
    expect(before.values["region.currency"]).toBe("BRL");
    expect(before.detail["region.currency"].source).toBe("partner");

    const view = await inWorkspace((tx) =>
      saveSettings(tx, workspace, {
        values: { "region.currency": "USD", "region.timezone": null },
      }),
    );
    expect(view.effective.detail["region.currency"]).toMatchObject({
      value: "USD",
      source: "workspace",
    });
    expect(view.own["region.currency"]?.locked).toBe(false);

    // Empty goes back to inheriting.
    const back = await inWorkspace((tx) =>
      saveSettings(tx, workspace, { values: { "region.currency": "" } }),
    );
    expect(back.own["region.currency"]).toBeUndefined();
    expect(back.effective.values["region.currency"]).toBe("BRL");
  });

  it("refuses members who do not manage the level", async () => {
    const viewer: SettingsActor = {
      level: "workspace",
      userId: ids.userMultiOrg,
      ctx: { ...contextMultiOrgInA, principalType: "user" },
    };
    const view = await withContext(prisma, viewer.ctx, (tx) =>
      settingsView(tx, viewer),
    );
    expect(view.canEdit).toBe(false);
    await expect(
      withContext(prisma, viewer.ctx, (tx) =>
        saveSettings(tx, viewer, { values: { "region.currency": "USD" } }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const support: SettingsActor = {
      ...partner,
      partnerRole: "partner_support",
    };
    await expect(
      inPartner((tx) =>
        saveSettings(tx, support, { values: { "region.currency": "USD" } }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
