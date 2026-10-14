import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { publishPlanVersion } from "@/core/billing/catalog";
import {
  loadPlansLimits,
  publishPlanLimits,
  saveQuotaCeilings,
} from "@/core/billing/limits";
import { loadUsage } from "@/core/entitlements/usage";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

/** Fixtures (tests/core/membership-seed.sql): users without memberships. */
const platformBilling = "d0000000-0000-4000-8000-000000000010";
const platformOperations = "d0000000-0000-4000-8000-000000000009";
const PLAN = "c4000000-0000-4000-8000-0000000000a1";
const PLAN_KEY = "teste-cf4";
/** Ceilings this suite writes; removed before and after. */
const KEYS = ["core.public_domains", "core.storage_gb", "core.seats"];

const hasKey = (messageKey: string) => (e: unknown) =>
  e instanceof AppError && e.messageKey === messageKey;

describeDatabase("CF4: plans and limits", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const billing = { userId: platformBilling, platformRole: "billing" as const };
  const operations = {
    userId: platformOperations,
    platformRole: "operations" as const,
  };
  const inPlatform = <T>(
    userId: string,
    fn: Parameters<typeof withIdentityContext<T>>[2],
  ) => withIdentityContext(prisma, userId, fn, { partnerId: HOUSE_PARTNER_ID });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.subscriptions where organization_id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.quota_ceilings where quota_key in (${KEYS.map((k) => `'${k}'`).join(", ")})`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.plan_versions where plan_id = '${PLAN}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.plans where id = '${PLAN}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_members where user_id in ('${platformBilling}', '${platformOperations}')`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status) values
       ('${platformBilling}', 'billing', 'active'),
       ('${platformOperations}', 'operations', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.plans (id, key, name) values ('${PLAN}', '${PLAN_KEY}', 'Teste CF4')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.plan_versions
       (plan_id, version, module_keys, min_price_cents, min_platform_share_cents,
        partner_base_price_cents, provisional, limits)
       values ('${PLAN}', 1, '{}'::text[], 9900, 2000, 5000, false, '{}'::jsonb)`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("shows the catalog with defaults, ceilings and the plan on sale", async () => {
    const view = await inPlatform(platformBilling, (tx) => loadPlansLimits(tx));
    const domains = view.rows.find(
      (row) => row.entry.key === "core.public_domains",
    );
    expect(domains).toMatchObject({ defaultLimit: 0, ceiling: null });
    expect(
      view.rows.find((row) => row.entry.key === "core.storage_gb")?.entry
        .status,
    ).toBe("planned");
    expect(view.plans.find((plan) => plan.planKey === PLAN_KEY)).toMatchObject({
      version: 1,
      limits: {},
    });
  });

  it("only billing managers set ceilings, and every change is audited", async () => {
    await expect(
      inPlatform(platformOperations, (tx) =>
        saveQuotaCeilings(tx, operations, { "core.public_domains": 3 }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const saved = await inPlatform(platformBilling, (tx) =>
      saveQuotaCeilings(tx, billing, {
        "core.public_domains": 3,
        "core.seats": null,
      }),
    );
    // Seats had no ceiling: only the domains changed.
    expect(saved).toEqual({ changed: 1 });
    const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
      `select count(*) from public.audit_events
       where action = 'billing.quota_ceiling.update' and resource_id = 'core.public_domains'`,
    );
    expect(Number(count)).toBeGreaterThanOrEqual(1);
  });

  it("publishes plan limits within the ceilings as a new version", async () => {
    const publish = (limits: Record<string, number | null>) =>
      inPlatform(platformBilling, (tx) =>
        publishPlanLimits(tx, billing, PLAN, limits),
      );
    await expect(publish({ "core.public_domains": 4 })).rejects.toSatisfy(
      hasKey("plans.errors.aboveCeiling"),
    );
    await expect(publish({ "core.public_domains": null })).rejects.toSatisfy(
      hasKey("plans.errors.unlimitedUnderCeiling"),
    );
    await expect(publish({ "core.seats": null })).rejects.toSatisfy(
      hasKey("plans.errors.unlimitedNotAccepted"),
    );

    const { version } = await publish({
      "core.public_domains": 2,
      "core.storage_gb": null,
    });
    expect(version).toBe(2);
    const [row] = await admin.$queryRawUnsafe<
      Array<{ limits: unknown; partner_base_price_cents: number }>
    >(
      `select limits, partner_base_price_cents from public.plan_versions
       where plan_id = '${PLAN}' and version = 2`,
    );
    // Prices are those of the current version; only the limits changed.
    expect(row).toEqual({
      limits: { "core.public_domains": 2, "core.storage_gb": null },
      partner_base_price_cents: 5000,
    });

    // The billing form publishes without limits: they are carried over.
    await inPlatform(platformBilling, (tx) =>
      publishPlanVersion(tx, billing, PLAN, {
        billingInterval: "monthly",
        moduleKeys: [],
        minPriceCents: 9900,
        minPlatformShareCents: 2000,
        partnerBasePriceCents: 6000,
        provisional: false,
      }),
    );
    const [carried] = await admin.$queryRawUnsafe<Array<{ limits: unknown }>>(
      `select limits from public.plan_versions where plan_id = '${PLAN}' and version = 3`,
    );
    expect(carried?.limits).toEqual({
      "core.public_domains": 2,
      "core.storage_gb": null,
    });
  });

  it("refuses a ceiling below a plan on sale and allows removing it", async () => {
    await expect(
      inPlatform(platformBilling, (tx) =>
        saveQuotaCeilings(tx, billing, { "core.public_domains": 1 }),
      ),
    ).rejects.toSatisfy(hasKey("plans.errors.ceilingBelowPlan"));
    await expect(
      inPlatform(platformBilling, (tx) =>
        saveQuotaCeilings(tx, billing, { "core.storage_gb": 100 }),
      ),
    ).rejects.toSatisfy(hasKey("plans.errors.ceilingBelowPlan"));

    await inPlatform(platformBilling, (tx) =>
      saveQuotaCeilings(tx, billing, { "core.public_domains": null }),
    );
    const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
      `select count(*) from public.quota_ceilings where quota_key = 'core.public_domains'`,
    );
    expect(Number(count)).toBe(0);
  });

  it("the customer's usage reads the plan value of the catalog", async () => {
    const [current] = await admin.$queryRawUnsafe<Array<{ id: string }>>(
      `select id from public.plan_versions where plan_id = '${PLAN}' and version = 3`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.subscriptions
       (partner_id, organization_id, plan_version_id, mode, payer, billing_interval,
        amount_cents, status)
       values ('${HOUSE_PARTNER_ID}', '${ids.organizationB}', '${current!.id}', 'partner_pays',
               'partner', 'monthly', 6000, 'active')`,
    );
    const usage = await withContext(prisma, contextB, (tx) =>
      loadUsage(tx, contextB),
    );
    expect(
      usage.rows.find((row) => row.key === "core.public_domains"),
    ).toMatchObject({ limit: 2, source: "plan", scope: "workspace" });
    // Planned keys have no measurement and stay off the usage page.
    expect(usage.rows.some((row) => row.key === "core.storage_gb")).toBe(false);
  });
});
