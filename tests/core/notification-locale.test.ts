import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runDailyTransitions } from "@/core/billing/automation";
import { loadMessagesFor } from "@/core/i18n/messages-loader";
import { notificationLocale } from "@/core/notifications/language";
import type { OutboundMessage } from "@/core/notifications/types";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = { ADMIN_URL: adminUrl, WORKER_DATABASE_URL: workerUrl };

/**
 * Partner R has no billing e-mail: its owners userA (en) and userMultiOrg
 * (no language) are notified. Partner S's billing e-mail belongs to its
 * finance member userB (es).
 */
const partnerR = "f5e00000-0000-4000-8000-0000000000a1";
const partnerS = "f5e00000-0000-4000-8000-0000000000a2";
const subR = "f5e00000-0000-4000-8000-0000000000b1";
const subS = "f5e00000-0000-4000-8000-0000000000b2";
const essentialPlan = "00000000-0000-4000-8000-0000000000a1";
const editedKey = "notifications.pastDue.subject";

describeDatabase(
  "I5: notifications in the recipient's language",
  requiredVars,
  () => {
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

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '${HOUSE_PARTNER_ID}'
       where partner_id in ('${partnerR}', '${partnerS}')`,
      );
      // Cascades to members, subscriptions and deliveries.
      await admin.$executeRawUnsafe(
        `delete from public.partners where id in ('${partnerR}', '${partnerS}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.platform_translations where key = '${editedKey}'`,
      );
      await admin.$executeRawUnsafe(
        `update public.platform_languages set is_default = false`,
      );
      await admin.$executeRawUnsafe(
        `update public.platform_languages set status = 'active', is_default = (code = 'pt-BR')
       where code in ('pt-BR', 'en', 'es')`,
      );
      await admin.$executeRawUnsafe(
        `update public.profiles set locale = null
       where id in ('${ids.userA}', '${ids.userB}', '${ids.userMultiOrg}')`,
      );
    }

    beforeAll(async () => {
      await cleanup();
      await admin.$executeRawUnsafe(
        `insert into public.partners (id, slug, name) values
        ('${partnerR}', 'agencia-i5-r', 'Agência R'),
        ('${partnerS}', 'agencia-i5-s', 'Agência S')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerR}', '${ids.userA}', 'dono@r.test', 'partner_owner'),
        ('${partnerR}', '${ids.userMultiOrg}', 'socio@r.test', 'partner_owner'),
        ('${partnerS}', '${ids.userB}', 'fin@s.test', 'partner_finance')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.partner_billing_profiles (partner_id, legal_name, tax_id, billing_email)
       values ('${partnerS}', 'Agência S Ltda', '11222333000181', 'Fin@S.test')`,
      );
      await admin.$executeRawUnsafe(
        `update public.profiles set locale = 'en' where id = '${ids.userA}'`,
      );
      await admin.$executeRawUnsafe(
        `update public.profiles set locale = 'es' where id = '${ids.userB}'`,
      );
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '${partnerR}' where id = '${ids.organizationA}'`,
      );
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '${partnerS}' where id = '${ids.organizationB}'`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.subscriptions
        (id, partner_id, organization_id, plan_version_id, mode, payer, billing_interval,
         amount_cents, status, current_period_start, current_period_end)
       select s.id::uuid, s.partner::uuid, s.org::uuid, v.id, 'partner_pays', 'partner', 'monthly',
              3000, 'active', '2026-08-01', '2026-09-01'
       from public.plan_versions v,
            (values ('${subR}', '${partnerR}', '${ids.organizationA}'),
                    ('${subS}', '${partnerS}', '${ids.organizationB}'))
              as s(id, partner, org)
       where v.plan_id = '${essentialPlan}' and v.version = 1`,
      );
    });

    afterAll(async () => {
      await cleanup();
      await admin.$disconnect();
      await workerDb.$disconnect();
    });

    it("resolves the language of a recipient as the worker", async () => {
      const locales = await asWorker(async (tx) => ({
        owner: await notificationLocale(tx, "Dono@R.test"),
        noLanguage: await notificationLocale(tx, "socio@r.test"),
        unknown: await notificationLocale(tx, "ninguem@x.test"),
      }));
      expect(locales).toEqual({
        owner: "en",
        noLanguage: "pt-BR",
        unknown: "pt-BR",
      });

      // Platform default, and a language turned off falls back to it.
      await admin.$executeRawUnsafe(
        `update public.platform_languages set is_default = false where code = 'pt-BR'`,
      );
      await admin.$executeRawUnsafe(
        `update public.platform_languages set is_default = true where code = 'es'`,
      );
      await admin.$executeRawUnsafe(
        `update public.platform_languages set status = 'disabled' where code = 'en'`,
      );
      try {
        const fallback = await asWorker(async (tx) => ({
          owner: await notificationLocale(tx, "dono@r.test"),
          unknown: await notificationLocale(tx, "ninguem@x.test"),
        }));
        expect(fallback).toEqual({ owner: "es", unknown: "es" });
      } finally {
        await admin.$executeRawUnsafe(
          `update public.platform_languages set is_default = false`,
        );
        await admin.$executeRawUnsafe(
          `update public.platform_languages set status = 'active', is_default = (code = 'pt-BR')
         where code in ('pt-BR', 'en', 'es')`,
        );
      }
    });

    it("loads the platform edits of a language as the worker", async () => {
      await admin.$executeRawUnsafe(
        `insert into public.platform_translations (locale, key, value)
       values ('es', '${editedKey}', 'Pago pendiente: {organization}')`,
      );
      const messages = await asWorker((tx) => loadMessagesFor(tx, "es"));
      const notifications = messages.notifications as Record<
        string,
        Record<string, string>
      >;
      expect(notifications.pastDue?.subject).toBe(
        "Pago pendiente: {organization}",
      );
      expect(notifications.suspended?.subject).toBe(
        "Suscripción suspendida: {organization}",
      );
    });

    it("sends each partner notice in the recipient's language", async () => {
      const sent: OutboundMessage[] = [];
      const transport = {
        async send(message: OutboundMessage) {
          sent.push(message);
          return { status: "skipped", reason: "no_provider" } as const;
        },
      };
      const result = await asWorker((tx) =>
        runDailyTransitions(tx, "2026-09-05", transport),
      );
      expect(result.pastDue).toBeGreaterThanOrEqual(2);

      const deliveries = await admin.notificationDelivery.findMany({
        where: { partnerId: { in: [partnerR, partnerS] } },
        orderBy: { recipientEmail: "asc" },
        select: { recipientEmail: true, subject: true, idempotencyKey: true },
      });
      expect(deliveries).toEqual([
        {
          recipientEmail: "dono@r.test",
          subject: "Subscription past due: Organization A",
          idempotencyKey: `subscription:${subR}:past_due:2026-09-01:dono@r.test`,
        },
        {
          // The platform edit of Spanish applies to the e-mail.
          recipientEmail: "fin@s.test",
          subject: "Pago pendiente: Organization B",
          idempotencyKey: `subscription:${subS}:past_due:2026-09-01:fin@s.test`,
        },
        {
          recipientEmail: "socio@r.test",
          subject: "Assinatura em atraso: Organization A",
          idempotencyKey: `subscription:${subR}:past_due:2026-09-01:socio@r.test`,
        },
      ]);

      const byRecipient = new Map(sent.map((m) => [m.to, m]));
      expect(byRecipient.get("dono@r.test")?.text).toContain(
        "Hello, Agência R.",
      );
      expect(byRecipient.get("dono@r.test")?.text).toContain("ended on 9/1/26");
      expect(byRecipient.get("fin@s.test")?.subject).toBe(
        "Pago pendiente: Organization B",
      );
      expect(byRecipient.get("fin@s.test")?.text).toContain(
        "Ver facturación: ",
      );
      expect(byRecipient.get("socio@r.test")?.text).toContain(
        "venceu em 01/09/2026",
      );
    });
  },
);
