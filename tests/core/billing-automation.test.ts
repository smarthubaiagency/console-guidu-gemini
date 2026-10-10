import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  billingJobs,
  billingSchedules,
  runDailyTransitions,
  runPayoutReport,
} from "@/core/billing/automation";
import {
  getBillingTerms,
  listNotificationDeliveries,
  listPayoutReports,
  updateBillingTerms,
} from "@/core/billing/operations";
import type { JobDefinition } from "@/core/jobs/definition";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { createJobWorker } from "@/worker/runtime";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

/** Partner P has a billing e-mail; partner Q only an owner. */
const partnerP = "f3c00000-0000-4000-8000-0000000000a1";
const partnerQ = "f3c00000-0000-4000-8000-0000000000a2";
const subP = "f3c00000-0000-4000-8000-0000000000b1";
const subQ = "f3c00000-0000-4000-8000-0000000000b2";
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const partnerFinance = "d0000000-0000-4000-8000-000000000005";
const partnerOwnerQ = "d0000000-0000-4000-8000-000000000006";
const platformBilling = "d0000000-0000-4000-8000-000000000010";
const essentialPlan = "00000000-0000-4000-8000-0000000000a1";

describeDatabase("F3c: billing in jobs", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });

  const asWorker = <T>(
    fn: (
      tx: Parameters<Parameters<typeof workerDb.$transaction>[0]>[0],
    ) => Promise<T>,
  ) => workerDb.$transaction(fn);

  const status = async (id: string) =>
    (await admin.subscription.findUniqueOrThrow({ where: { id } })).status;

  // Audit events are append-only: count only this run's.
  const testStartedAt = new Date();

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where kind like 'billing.%'`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${HOUSE_PARTNER_ID}'
       where partner_id in ('${partnerP}', '${partnerQ}')`,
    );
    // Cascades to subscriptions, payments, events, deliveries and reports.
    await admin.$executeRawUnsafe(
      `delete from public.partners where id in ('${partnerP}', '${partnerQ}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_members where user_id = '${platformBilling}'`,
    );
    await admin.$executeRawUnsafe(
      `update public.billing_settings
       set past_due_after_days = 3, suspend_after_days = 7, provisional = true, updated_by = null`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values
        ('${partnerP}', 'agencia-f3c-p', 'Agência P'),
        ('${partnerQ}', 'agencia-f3c-q', 'Agência Q')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerP}', '${partnerOwner}', 'dono@p.test', 'partner_owner'),
        ('${partnerP}', '${partnerFinance}', 'fin@p.test', 'partner_finance'),
        ('${partnerQ}', '${partnerOwnerQ}', 'dono@q.test', 'partner_owner')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_billing_profiles (partner_id, legal_name, tax_id, billing_email)
       values ('${partnerP}', 'Agência P Ltda', '11222333000181', 'cobranca@p.test')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_domains (host, partner_id, kind, status)
       values ('cobranca.agencia-p.test', '${partnerP}', 'custom', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status)
       values ('${platformBilling}', 'billing', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${partnerP}' where id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${partnerQ}' where id = '${ids.organizationA}'`,
    );
    // P: paid until 2026-10-01 (active). Q: already in arrears since the
    // period that ended on 2026-09-20.
    await admin.$executeRawUnsafe(
      `insert into public.subscriptions
        (id, partner_id, organization_id, plan_version_id, mode, payer, billing_interval,
         amount_cents, status, current_period_start, current_period_end)
       select s.id::uuid, s.partner::uuid, s.org::uuid, v.id, 'partner_pays', 'partner', 'monthly',
              3000, s.status, s.start_on::date, s.end_on::date
       from public.plan_versions v,
            (values ('${subP}', '${partnerP}', '${ids.organizationB}', 'active', '2026-09-01', '2026-10-01'),
                    ('${subQ}', '${partnerQ}', '${ids.organizationA}', 'past_due', '2026-08-20', '2026-09-20'))
              as s(id, partner, org, status, start_on, end_on)
       where v.plan_id = '${essentialPlan}' and v.version = 1`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("runs the daily routine from the scheduler, with a controlled clock", async () => {
    let now = new Date("2026-10-04T08:00:00Z");
    const worker = createJobWorker({
      databaseUrl: workerUrl ?? "",
      definitions: billingJobs as unknown as readonly JobDefinition<unknown>[],
      schedules: [billingSchedules[0]!],
      scheduleIntervalMs: 3_600_000,
      dispatchIntervalMs: 200,
      pollingIntervalSeconds: 0.5,
      now: () => now,
      log: () => {},
    });
    try {
      // Before 06:00 in Brasília nothing is due; then one run per date,
      // however many ticks.
      expect(await worker.scheduleOnce()).toBe(0);
      now = new Date("2026-10-04T09:30:00Z");
      expect(await worker.scheduleOnce()).toBe(1);
      expect(await worker.scheduleOnce()).toBe(0);

      await worker.start();
      const deadline = Date.now() + 20_000;
      let run = await admin.jobRun.findFirstOrThrow({
        where: {
          kind: "billing.daily-transitions",
          idempotencyKey: "2026-10-04",
        },
      });
      while (!["succeeded", "failed", "skipped"].includes(run.status)) {
        if (Date.now() > deadline) throw new Error(`timeout: ${run.status}`);
        await new Promise((resolve) => setTimeout(resolve, 150));
        run = await admin.jobRun.findUniqueOrThrow({ where: { id: run.id } });
      }
      expect(run).toMatchObject({ status: "succeeded", scope: "platform" });
      expect(run.result).toMatchObject({ date: "2026-10-04" });
    } finally {
      await worker.stop();
    }

    // P went into arrears; Q's grace ended on 2026-09-30, so it is suspended.
    expect(await status(subP)).toBe("past_due");
    expect(await status(subQ)).toBe("suspended");

    const deliveries = await admin.notificationDelivery.findMany({
      where: { partnerId: { in: [partnerP, partnerQ] } },
      orderBy: { recipientEmail: "asc" },
    });
    expect(
      deliveries.map((d) => [
        d.recipientEmail,
        d.eventType,
        d.status,
        d.reason,
      ]),
    ).toEqual([
      // Billing e-mail first; the owner only when there is none.
      [
        "cobranca@p.test",
        "billing.subscription.past_due",
        "skipped",
        "no_provider",
      ],
      [
        "dono@q.test",
        "billing.subscription.suspended",
        "skipped",
        "no_provider",
      ],
    ]);
    expect(deliveries[0]?.subject).toBe("Assinatura em atraso: Organization B");

    const audits = await admin.$queryRawUnsafe<
      {
        actor_principal_type: string;
        origin: string;
        metadata: { to: string };
      }[]
    >(
      `select actor_principal_type, origin, metadata from public.audit_events
       where resource_id in ('${subP}', '${subQ}') and action = 'billing.subscription.status'
         and occurred_at >= '${testStartedAt.toISOString()}'
       order by occurred_at`,
    );
    expect(audits).toHaveLength(2);
    expect(
      audits.every(
        (a) => a.actor_principal_type === "service" && a.origin === "worker",
      ),
    ).toBe(true);
  });

  it("runs the same date again without a second effect", async () => {
    const again = await asWorker((tx) => runDailyTransitions(tx, "2026-10-04"));
    expect(again).toMatchObject({ pastDue: 0, suspended: 0, notices: 0 });
    const notSuspendedYet = await asWorker((tx) =>
      runDailyTransitions(tx, "2026-10-10"),
    );
    expect(notSuspendedYet.suspended).toBe(0);
    expect(await status(subP)).toBe("past_due");
    expect(
      await admin.notificationDelivery.count({
        where: { partnerId: { in: [partnerP, partnerQ] } },
      }),
    ).toBe(2);
  });

  it("suspends after the grace and notifies once", async () => {
    const result = await asWorker((tx) =>
      runDailyTransitions(tx, "2026-10-11"),
    );
    expect(result.suspended).toBeGreaterThanOrEqual(1);
    expect(await status(subP)).toBe("suspended");
    await asWorker((tx) => runDailyTransitions(tx, "2026-10-12"));
    const notices = await admin.notificationDelivery.findMany({
      where: {
        partnerId: partnerP,
        eventType: "billing.subscription.suspended",
      },
    });
    expect(notices).toHaveLength(1);

    // The partner sees its own notices only; the platform sees all.
    const forPartner = await withIdentityContext(
      prisma,
      partnerFinance,
      (tx) =>
        listNotificationDeliveries(
          tx,
          { userId: partnerFinance, partnerRole: "partner_finance" },
          partnerP,
        ),
      { partnerId: partnerP },
    );
    expect(forPartner.map((n) => n.eventType).sort()).toEqual([
      "billing.subscription.past_due",
      "billing.subscription.suspended",
    ]);
    expect(forPartner.every((n) => n.partnerId === partnerP)).toBe(true);
  });

  it("does not undo a payment recorded after the arrears", async () => {
    // A payment moves Q back to active with a new period; the routine only
    // acts again when that period is overdue.
    await admin.$executeRawUnsafe(
      `update public.subscriptions set status = 'active',
         current_period_start = '2026-10-12', current_period_end = '2026-11-12'
       where id = '${subQ}'`,
    );
    await asWorker((tx) => runDailyTransitions(tx, "2026-10-13"));
    expect(await status(subQ)).toBe("active");
  });

  it("generates the payout report of a month once", async () => {
    await admin.$executeRawUnsafe(
      `insert into public.payment_provider_events
         (id, provider, external_id, event_type, partner_id, status, processed_at) values
         ('f3c00000-0000-4000-8000-0000000000e1', 'iugu', 'f3c-1', 'payment.paid', '${partnerP}', 'processed', now()),
         ('f3c00000-0000-4000-8000-0000000000e2', 'iugu', 'f3c-2', 'payment.paid', '${partnerP}', 'processed', now()),
         ('f3c00000-0000-4000-8000-0000000000e3', 'iugu', 'f3c-3', 'payment.refunded', '${partnerP}', 'processed', now()),
         ('f3c00000-0000-4000-8000-0000000000e4', 'iugu', 'f3c-4', 'payment.paid', '${partnerP}', 'processed', now())`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.payments
         (id, partner_id, organization_id, subscription_id, kind, refund_of, provider, provider_event_id,
          method, amount_cents, platform_share_cents, partner_share_cents, period_start, period_end, paid_on)
       values
         ('f3c00000-0000-4000-8000-0000000000c1', '${partnerP}', '${ids.organizationB}', '${subP}', 'payment', null,
          'iugu', 'f3c00000-0000-4000-8000-0000000000e1', 'pix', 3000, 2000, 1000, '2026-08-01', '2026-09-01', '2026-09-02'),
         ('f3c00000-0000-4000-8000-0000000000c2', '${partnerP}', '${ids.organizationB}', '${subP}', 'payment', null,
          'iugu', 'f3c00000-0000-4000-8000-0000000000e2', 'pix', 3000, 2000, 1000, '2026-09-01', '2026-10-01', '2026-09-20'),
         ('f3c00000-0000-4000-8000-0000000000c3', '${partnerP}', '${ids.organizationB}', '${subP}', 'refund',
          'f3c00000-0000-4000-8000-0000000000c1', 'iugu', 'f3c00000-0000-4000-8000-0000000000e3', 'pix',
          3000, 2000, 1000, null, null, '2026-09-25'),
         ('f3c00000-0000-4000-8000-0000000000c4', '${partnerP}', '${ids.organizationB}', '${subP}', 'payment', null,
          'iugu', 'f3c00000-0000-4000-8000-0000000000e4', 'pix', 3000, 2000, 1000, '2026-10-01', '2026-11-01', '2026-10-02')`,
    );

    const first = await asWorker((tx) => runPayoutReport(tx, "2026-09"));
    expect(first.created).toBeGreaterThanOrEqual(1);
    const second = await asWorker((tx) => runPayoutReport(tx, "2026-09"));
    expect(second.created).toBe(0);

    const reports = await withIdentityContext(
      prisma,
      partnerFinance,
      (tx) =>
        listPayoutReports(
          tx,
          { userId: partnerFinance, partnerRole: "partner_finance" },
          partnerP,
        ),
      { partnerId: partnerP },
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      partnerName: "Agência P",
      paymentsCount: 2,
      receivedCents: 6000,
      refundedCents: 3000,
      platformNetCents: 2000,
      partnerNetCents: 1000,
    });
    expect(reports[0]?.periodStart.toISOString().slice(0, 10)).toBe(
      "2026-09-01",
    );
  });

  it("lets only platform billing change the terms, used by the next run", async () => {
    const financeActor = {
      userId: partnerFinance,
      partnerRole: "partner_finance" as const,
    };
    await expect(
      withIdentityContext(
        prisma,
        partnerFinance,
        (tx) =>
          updateBillingTerms(tx, financeActor, {
            pastDueAfterDays: 0,
            suspendAfterDays: 1,
            provisional: false,
          }),
        { partnerId: partnerP },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const billingActor = {
      userId: platformBilling,
      platformRole: "billing" as const,
    };
    await withIdentityContext(
      prisma,
      platformBilling,
      (tx) =>
        updateBillingTerms(tx, billingActor, {
          pastDueAfterDays: 0,
          suspendAfterDays: 1,
          provisional: false,
        }),
      { partnerId: HOUSE_PARTNER_ID },
    );
    const terms = await withIdentityContext(
      prisma,
      partnerFinance,
      (tx) => getBillingTerms(tx, financeActor),
      { partnerId: partnerP },
    );
    expect(terms).toMatchObject({
      pastDueAfterDays: 0,
      suspendAfterDays: 1,
      provisional: false,
    });

    // With no tolerance, Q is in arrears on the day its period ends.
    await asWorker((tx) => runDailyTransitions(tx, "2026-11-12"));
    expect(await status(subQ)).toBe("past_due");
  });
});
