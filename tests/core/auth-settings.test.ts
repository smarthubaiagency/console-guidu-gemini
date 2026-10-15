import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loginMethodsFor } from "@/core/auth/login-methods";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  saveSettings,
  settingsView,
  type SettingsActor,
} from "@/core/settings/service";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF5b: Configurações › Autenticação. The platform offers Google and the
 * link by e-mail, the partner may only hide them on its hosts, the login
 * page reads both before sign-in through `private.auth_login_settings`,
 * and every change is audited.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "bcf5b000-0000-4000-8000-000000000001";
const OTHER = "bcf5b000-0000-4000-8000-000000000002";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const PARTNER_OWNER = ids.userMultiOrg;
const PROVIDERS_ON = {
  AUTH_GOOGLE_ENABLED: "true",
  AUTH_MAGIC_LINK_ENABLED: "true",
};

describeDatabase("CF5b: authentication settings", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const startedAt = new Date();

  const platform: SettingsActor = {
    level: "platform",
    userId: PLATFORM_OWNER,
    platformRole: "owner",
  };
  const partner: SettingsActor = {
    level: "partner",
    userId: PARTNER_OWNER,
    partnerId: PARTNER,
    partnerRole: "partner_owner",
  };

  const inPlatform = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, PLATFORM_OWNER, op);
  const inPartner = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, PARTNER_OWNER, op, { partnerId: PARTNER });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.settings where key like 'auth.%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id in ('${PARTNER}', '${OTHER}')`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values
         ('${PARTNER}', 'agencia-cf5b', 'Agência CF5b'),
         ('${OTHER}', 'outra-cf5b', 'Outra CF5b')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${PARTNER}', '${PARTNER_OWNER}', 'owner@cf5b.test', 'partner_owner')`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("offers nothing by default, and the partner cannot turn a method on", async () => {
    expect(await loginMethodsFor(prisma, PARTNER, PROVIDERS_ON)).toEqual({
      google: false,
      magicLink: false,
    });
    const view = await inPartner((tx) => settingsView(tx, partner));
    expect(view.inherited.detail["auth.google"].lockedBy).toBe("platform");
    await expect(
      inPartner((tx) =>
        saveSettings(tx, partner, { values: { "auth.google": false } }),
      ),
    ).rejects.toMatchObject({ messageKey: "settings.errors.locked" });
  });

  it("shows what the platform offers, with the provider on", async () => {
    await inPlatform((tx) =>
      saveSettings(tx, platform, {
        values: { "auth.google": true, "auth.magic_link": true },
      }),
    );
    expect(await loginMethodsFor(prisma, PARTNER, PROVIDERS_ON)).toEqual({
      google: true,
      magicLink: true,
    });
    // Without the provider flags, nothing shows.
    expect(await loginMethodsFor(prisma, PARTNER, {})).toEqual({
      google: false,
      magicLink: false,
    });
    expect(
      await loginMethodsFor(prisma, null, { AUTH_GOOGLE_ENABLED: "true" }),
    ).toEqual({ google: true, magicLink: false });
  });

  it("lets a partner hide a method on its hosts only", async () => {
    await inPartner((tx) =>
      saveSettings(tx, partner, { values: { "auth.magic_link": false } }),
    );
    expect(await loginMethodsFor(prisma, PARTNER, PROVIDERS_ON)).toEqual({
      google: true,
      magicLink: false,
    });
    expect(await loginMethodsFor(prisma, OTHER, PROVIDERS_ON)).toEqual({
      google: true,
      magicLink: true,
    });

    // Partner support reads but does not change it.
    await expect(
      inPartner((tx) =>
        saveSettings(
          tx,
          { ...partner, partnerRole: "partner_support" },
          { values: { "auth.google": false } },
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("withdraws a method from every partner when the platform turns it off", async () => {
    await inPlatform((tx) =>
      saveSettings(tx, platform, { values: { "auth.google": null } }),
    );
    expect(await loginMethodsFor(prisma, OTHER, PROVIDERS_ON)).toEqual({
      google: false,
      magicLink: true,
    });
  });

  it("audits every change of each level", async () => {
    const rows = await admin.$queryRawUnsafe<
      { action: string; fields: string }[]
    >(
      `select action, metadata ->> 'fields' as fields from public.audit_events
       where actor_user_id in ('${PLATFORM_OWNER}', '${PARTNER_OWNER}')
         and action in ('platform.settings.save', 'partner.settings.save')
         and metadata ->> 'fields' like '%auth.%'
         and occurred_at >= $1
       order by occurred_at`,
      startedAt,
    );
    const actions = rows.map((row) => row.action);
    expect(actions.filter((a) => a === "platform.settings.save")).toHaveLength(
      2,
    );
    expect(actions).toContain("partner.settings.save");
  });
});
