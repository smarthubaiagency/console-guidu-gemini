import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analyticsClientConfig } from "@/core/analytics/config";
import {
  analyticsValues,
  cachedAnalyticsValues,
  clearAnalyticsCache,
  readAnalyticsRows,
} from "@/core/analytics/values";
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
 * CF7: product analytics. Off by default; the platform turns it on with a
 * provider and an identifier, the partner adds its own identifier, and the
 * login page and the proxy read only the `analytics.*` rows before
 * sign-in.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "bcf70000-0000-4000-8000-000000000001";
const OTHER = "bcf70000-0000-4000-8000-000000000002";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const PARTNER_OWNER = ids.userMultiOrg;

describeDatabase("CF7: product analytics settings", requiredVars, () => {
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
      `delete from public.settings where key like 'analytics.%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id in ('${PARTNER}', '${OTHER}')`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values
         ('${PARTNER}', 'agencia-cf7', 'Agência CF7'),
         ('${OTHER}', 'outra-cf7', 'Outra CF7')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${PARTNER}', '${PARTNER_OWNER}', 'owner@cf7.test', 'partner_owner')`,
    );
    clearAnalyticsCache();
  });

  afterAll(async () => {
    await cleanup();
    clearAnalyticsCache();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("is off by default: no browser configuration, no CSP origin", async () => {
    const values = await cachedAnalyticsValues(PARTNER, prisma);
    expect(values).toMatchObject({ enabled: false, provider: "plausible" });
    expect(
      analyticsClientConfig(values!, { partnerOwn: true, production: true }),
    ).toBeNull();
  });

  it("follows the platform switch and adds the partner's own site on its hosts", async () => {
    await inPlatform((tx) =>
      saveSettings(tx, platform, {
        values: {
          "analytics.enabled": true,
          "analytics.provider": "plausible",
          "analytics.site_id": "painel.guidu.test",
        },
      }),
    );
    await inPartner((tx) =>
      saveSettings(tx, partner, {
        values: {
          "analytics.partner_enabled": true,
          "analytics.partner_site_id": "painel.agencia.test",
        },
      }),
    );
    // The partner never writes the platform's keys.
    await expect(
      inPartner((tx) =>
        saveSettings(tx, partner, { values: { "analytics.enabled": false } }),
      ),
    ).rejects.toMatchObject({ messageKey: "settings.errors.unknown" });

    clearAnalyticsCache();
    const values = await cachedAnalyticsValues(PARTNER, prisma);
    const config = analyticsClientConfig(values!, {
      partnerOwn: true,
      production: true,
    });
    expect(config?.sites.map((site) => site.siteId)).toEqual([
      "painel.guidu.test",
      "painel.agencia.test",
    ]);

    // Another partner's host only gets the platform's site.
    const other = analyticsValues(await readAnalyticsRows(prisma, OTHER));
    expect(other.partnerSiteId).toBeNull();

    // The platform turns it off: nothing goes out, the partner included.
    await inPlatform((tx) =>
      saveSettings(tx, platform, { values: { "analytics.enabled": false } }),
    );
    clearAnalyticsCache();
    const off = await cachedAnalyticsValues(PARTNER, prisma);
    expect(
      analyticsClientConfig(off!, { partnerOwn: true, production: true }),
    ).toBeNull();
    const view = await inPartner((tx) => settingsView(tx, partner));
    expect(view.effective.values["analytics.partner_site_id"]).toBe(
      "painel.agencia.test",
    );
  });

  it("returns only analytics rows before sign-in", async () => {
    const rows = await readAnalyticsRows(prisma, PARTNER);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.key.startsWith("analytics."))).toBe(true);
  });
});
