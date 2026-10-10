import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveWorkspaceContext } from "@/core/auth/context";
import {
  createPlan,
  listPartnerTotals,
  publishPlanVersion,
  publishSplitRule,
  refundPayment,
  setCheckoutBlocked,
} from "@/core/billing/catalog";
import {
  getWorkspaceBilling,
  openDemoCheckout,
  simulateDemoCheckout,
} from "@/core/billing/customer";
import {
  changeSubscriptionStatus,
  checkoutPrerequisites,
  createPartnerPlan,
  listCustomerSubscriptions,
  recordManualPayment,
  saveBillingProfile,
  setCheckoutEnabled,
  startSubscription,
} from "@/core/billing/partner";
import { publishLegalDocument } from "@/core/legal/service";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { createPartnerCustomer } from "@/core/partners/customers";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

/** Fixtures (tests/core/membership-seed.sql): users without memberships. */
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const partnerFinance = "d0000000-0000-4000-8000-000000000005";
const partnerAdmin = "d0000000-0000-4000-8000-000000000006";
const platformBilling = "d0000000-0000-4000-8000-000000000010";
const partnerId = "b0000000-0000-4000-8000-0000000000e5";
const testPlanKey = "teste-p5m";
// Unique per run: audited companies are never deleted, only detached.
const slug = `cliente-p5m-${Date.now().toString(36)}`;

// A PDF header is enough for the real-type check of the evidence.
const evidence = new TextEncoder().encode("%PDF-1.7\n% comprovante\n");
const isAppError = (code: string) => (e: unknown) =>
  e instanceof AppError && e.code === code;

describeDatabase(
  "P5m: manual billing (ADR 0012, D-PA-14)",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });

    const finance = {
      userId: partnerFinance,
      partnerRole: "partner_finance" as const,
    };
    const partnerAdminActor = {
      userId: partnerAdmin,
      partnerRole: "partner_admin" as const,
    };
    const owner = {
      userId: partnerOwner,
      partnerRole: "partner_owner" as const,
    };
    const platform = {
      userId: platformBilling,
      platformRole: "billing" as const,
    };

    const inPartner = <T>(
      userId: string,
      fn: Parameters<typeof withIdentityContext<T>>[2],
    ) => withIdentityContext(prisma, userId, fn, { partnerId });
    const inPlatform = <T>(fn: Parameters<typeof withIdentityContext<T>>[2]) =>
      withIdentityContext(prisma, platformBilling, fn, {
        partnerId: HOUSE_PARTNER_ID,
      });

    let subscriptionId = "";
    let paymentId = "";

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '${HOUSE_PARTNER_ID}' where partner_id = '${partnerId}'`,
      );
      // Cascades to subscriptions, payments, events, prices and documents.
      await admin.$executeRawUnsafe(
        `delete from public.partners where id = '${partnerId}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.plan_versions where plan_id in (select id from public.plans where key = '${testPlanKey}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.plans where key = '${testPlanKey}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.platform_admin_members where user_id = '${platformBilling}'`,
      );
    }

    beforeAll(async () => {
      await cleanup();
      await admin.$executeRawUnsafe(
        `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-p5m', 'Agência P5m')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerId}', '${partnerOwner}', 'dono@p5m.test', 'partner_owner'),
        ('${partnerId}', '${partnerFinance}', 'fin@p5m.test', 'partner_finance'),
        ('${partnerId}', '${partnerAdmin}', 'admin@p5m.test', 'partner_admin')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.platform_admin_members (user_id, role, status) values ('${platformBilling}', 'billing', 'active')`,
      );
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '${partnerId}' where id = '${ids.organizationB}'`,
      );
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("registers a customer with a pending subscription (criterion 10)", async () => {
      const created = await inPartner(partnerAdmin, (tx) =>
        createPartnerCustomer(
          tx,
          partnerAdminActor,
          partnerId,
          {
            organizationName: "Cliente P5m",
            workspaceName: "Principal",
            workspaceSlug: slug,
            ownerEmail: "dono@cliente-p5m.test",
          },
          "http://agencia-p5m.localhost:3000",
        ),
      );
      const rows = await inPartner(partnerFinance, (tx) =>
        listCustomerSubscriptions(tx, finance, partnerId),
      );
      const row = rows.find((r) => r.organizationId === created.organizationId);
      expect(row?.subscription).toMatchObject({
        status: "pending",
        planName: "Essencial",
        mode: "partner_pays",
        amountCents: 3000,
        provisional: true,
      });
    });

    it("activates on a manual payment with evidence, once (criteria 5 and 10)", async () => {
      await expect(
        inPartner(partnerAdmin, (tx) =>
          startSubscription(tx, partnerAdminActor, partnerId, {
            organizationId: ids.organizationB,
            planId: "00000000-0000-4000-8000-0000000000a1",
          }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      ({ id: subscriptionId } = await inPartner(partnerFinance, (tx) =>
        startSubscription(tx, finance, partnerId, {
          organizationId: ids.organizationB,
          planId: "00000000-0000-4000-8000-0000000000a1",
        }),
      ));

      const form = {
        subscriptionId,
        amountCents: 3000,
        method: "pix",
        paidOn: new Date(),
        note: "Transferência de outubro",
        evidence,
        idempotencyKey: randomUUID(),
      };
      await expect(
        inPartner(partnerFinance, (tx) =>
          recordManualPayment(tx, finance, partnerId, {
            ...form,
            amountCents: 2999,
          }),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
      await expect(
        inPartner(partnerFinance, (tx) =>
          recordManualPayment(tx, finance, partnerId, {
            ...form,
            evidence: null,
          }),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
      await expect(
        inPartner(partnerFinance, (tx) =>
          recordManualPayment(tx, finance, partnerId, {
            ...form,
            evidence: new TextEncoder().encode("<svg/>"),
          }),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
      await expect(
        inPartner(partnerAdmin, (tx) =>
          recordManualPayment(tx, partnerAdminActor, partnerId, form),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const first = await inPartner(partnerFinance, (tx) =>
        recordManualPayment(tx, finance, partnerId, form),
      );
      expect(first.outcome).toBe("processed");
      paymentId = first.paymentId ?? "";
      const again = await inPartner(partnerFinance, (tx) =>
        recordManualPayment(tx, finance, partnerId, form),
      );
      expect(again).toEqual({ outcome: "duplicate", paymentId: null });

      const payments = await admin.payment.findMany({
        where: { subscriptionId },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        amountCents: 3000,
        platformShareCents: 3000,
        partnerShareCents: 0,
        evidenceMime: "application/pdf",
      });
      const sub = await admin.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.status).toBe("active");
      expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    });

    it("shows the plan to the customer, never payments or checkout while off (criteria 9 and 11)", async () => {
      const ownerCtx = await resolveWorkspaceContext(
        prisma,
        ids.userB,
        "workspace-b",
        partnerId,
      );
      const view = await withContext(prisma, ownerCtx, (tx) =>
        getWorkspaceBilling(tx, ownerCtx, partnerId),
      );
      expect(view).toMatchObject({
        subscription: {
          status: "active",
          planName: "Essencial",
          mode: "partner_pays",
        },
        checkoutAvailable: false,
      });
      await withContext(prisma, ownerCtx, async (tx) => {
        expect(await tx.payment.count()).toBe(0);
        expect(await tx.paymentProviderEvent.count()).toBe(0);
      });
      await expect(
        withContext(prisma, ownerCtx, (tx) =>
          openDemoCheckout(tx, ownerCtx, partnerId),
        ),
      ).rejects.toSatisfy(isAppError("not_found"));
    });

    it("refuses partner prices below the floor (criterion 4)", async () => {
      await expect(
        inPartner(partnerFinance, (tx) =>
          createPartnerPlan(tx, finance, partnerId, {
            planId: "00000000-0000-4000-8000-0000000000a1",
            name: "Barato",
            priceCents: 9999,
          }),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
      await inPartner(partnerFinance, (tx) =>
        createPartnerPlan(tx, finance, partnerId, {
          planId: "00000000-0000-4000-8000-0000000000a1",
          name: "Completo",
          priceCents: 15000,
        }),
      );
    });

    it("keeps existing subscriptions when versions and rules change (criterion 6)", async () => {
      const { id: planId } = await inPlatform((tx) =>
        createPlan(tx, platform, { key: testPlanKey, name: "Teste P5m" }),
      );
      await inPlatform((tx) =>
        publishPlanVersion(tx, platform, planId, {
          billingInterval: "monthly",
          moduleKeys: [],
          minPriceCents: 5000,
          minPlatformShareCents: 1000,
          partnerBasePriceCents: 1000,
          provisional: false,
        }),
      );
      const v2 = await inPlatform((tx) =>
        publishPlanVersion(tx, platform, planId, {
          billingInterval: "monthly",
          moduleKeys: [],
          minPriceCents: 6000,
          minPlatformShareCents: 1500,
          partnerBasePriceCents: 1500,
          provisional: false,
        }),
      );
      expect(v2.version).toBe(2);
      await inPlatform((tx) =>
        publishSplitRule(tx, platform, { partnerId, platformPercentBp: 2500 }),
      );
      await expect(
        inPartner(partnerFinance, (tx) =>
          publishSplitRule(tx, finance, { partnerId, platformPercentBp: 0 }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const sub = await admin.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { planVersion: true },
      });
      expect(sub.amountCents).toBe(3000);
      expect(sub.planVersion.version).toBe(1);
    });

    it("lets the platform refund once and marks the subscription past due", async () => {
      const totalsBefore = await inPlatform((tx) =>
        listPartnerTotals(tx, platform),
      );
      expect(totalsBefore.find((t) => t.partnerId === partnerId)).toMatchObject(
        {
          receivedCents: 3000,
          platformNetCents: 3000,
          openSubscriptions: 2,
        },
      );

      expect(
        (
          await inPlatform((tx) =>
            refundPayment(tx, platform, paymentId, "Comprovante ilegível"),
          )
        ).outcome,
      ).toBe("processed");
      expect(
        (await inPlatform((tx) => refundPayment(tx, platform, paymentId, null)))
          .outcome,
      ).toBe("duplicate");

      const sub = await admin.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.status).toBe("past_due");
      const totals = await inPlatform((tx) => listPartnerTotals(tx, platform));
      expect(totals.find((t) => t.partnerId === partnerId)).toMatchObject({
        refundedCents: 3000,
        platformNetCents: 0,
      });

      // Manual marks follow the state machine; canceled is final.
      await inPartner(partnerFinance, (tx) =>
        changeSubscriptionStatus(
          tx,
          finance,
          partnerId,
          subscriptionId,
          "suspended",
        ),
      );
      await inPartner(partnerFinance, (tx) =>
        changeSubscriptionStatus(
          tx,
          finance,
          partnerId,
          subscriptionId,
          "canceled",
        ),
      );
      await expect(
        inPartner(partnerFinance, (tx) =>
          recordManualPayment(tx, finance, partnerId, {
            subscriptionId,
            amountCents: 3000,
            method: "pix",
            paidOn: new Date(),
            evidence,
            idempotencyKey: randomUUID(),
          }),
        ),
      ).rejects.toSatisfy(isAppError("conflict"));
    });

    it("turns the checkout on only with prerequisites, as a demonstration", async () => {
      await expect(
        inPartner(partnerAdmin, (tx) =>
          setCheckoutEnabled(tx, partnerAdminActor, partnerId, true),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      // No terms or privacy policy published yet.
      await expect(
        inPartner(partnerFinance, (tx) =>
          setCheckoutEnabled(tx, finance, partnerId, true),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));

      for (const kind of ["terms", "privacy"] as const) {
        await inPartner(partnerOwner, (tx) =>
          publishLegalDocument(tx, owner, partnerId, {
            kind,
            title: kind,
            body: "Texto",
            requiresAcceptance: true,
          }),
        );
      }
      await inPartner(partnerFinance, (tx) =>
        saveBillingProfile(tx, finance, partnerId, {
          legalName: "Agência P5m Ltda",
          taxId: "11.222.333/0001-81",
          billingEmail: "financeiro@p5m.test",
        }),
      );
      const prerequisites = await inPartner(partnerFinance, (tx) =>
        checkoutPrerequisites(tx, partnerId),
      );
      expect(
        prerequisites.filter((p) => p.requiredNow).every((p) => p.met),
      ).toBe(true);
      expect(
        prerequisites.filter((p) => !p.requiredNow).map((p) => p.key),
      ).toEqual(["recipient", "split_provider"]);
      await inPartner(partnerFinance, (tx) =>
        setCheckoutEnabled(tx, finance, partnerId, true),
      );

      const ownerCtx = await resolveWorkspaceContext(
        prisma,
        ids.userB,
        "workspace-b",
        partnerId,
      );
      const checkout = await withContext(prisma, ownerCtx, (tx) =>
        openDemoCheckout(tx, ownerCtx, partnerId),
      );
      expect(checkout.demo).toBe(true);
      expect(checkout.plans.map((p) => [p.name, p.priceCents])).toEqual([
        ["Completo", 15000],
      ]);
      await expect(
        withContext(prisma, ownerCtx, (tx) =>
          simulateDemoCheckout(tx, ownerCtx, partnerId, checkout.plans[0]!.id),
        ),
      ).resolves.toEqual({ demo: true, charged: false, planName: "Completo" });
      expect(
        await admin.payment.count({ where: { partnerId, kind: "payment" } }),
      ).toBe(1);

      // The platform block turns it off and keeps it off.
      await withIdentityContext(
        prisma,
        "d0000000-0000-4000-8000-000000000003",
        (tx) =>
          setCheckoutBlocked(
            tx,
            {
              userId: "d0000000-0000-4000-8000-000000000003",
              platformRole: "owner",
            },
            partnerId,
            true,
          ),
        { partnerId: HOUSE_PARTNER_ID },
      );
      await expect(
        withContext(prisma, ownerCtx, (tx) =>
          openDemoCheckout(tx, ownerCtx, partnerId),
        ),
      ).rejects.toSatisfy(isAppError("not_found"));
      await expect(
        inPartner(partnerFinance, (tx) =>
          setCheckoutEnabled(tx, finance, partnerId, true),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
    });
  },
);
