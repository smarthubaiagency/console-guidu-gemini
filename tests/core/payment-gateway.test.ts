import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  gatewayHistory,
  getStripeGateway,
  loadTestWebhookSecret,
  reprocessFailedEvents,
  saveStripeCredentials,
  saveStripeSettings,
  webhookHealth,
} from "@/core/billing/gateway/service";
import {
  buildTestEvent,
  STRIPE_WEBHOOK_PATH,
} from "@/core/billing/gateway/stripe";
import { signStripePayload } from "@/core/billing/gateway/stripe-signature";
import { receiveStripeWebhook } from "@/core/billing/gateway/webhook";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF7: Cobrança › Gateway (Stripe Connect). Platform billing (owner and
 * billing) configures it, credentials stay encrypted and masked, the
 * webhook checks the signature, stores the raw body once per event id and
 * only records it; failures are reprocessed idempotently.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const OWNER = "d0000000-0000-4000-8000-000000000003";
const BILLING = "d0000000-0000-4000-8000-000000000010";
const OPERATIONS = "d0000000-0000-4000-8000-000000000009";
const SECRET_KEY = `sk_test_${"9z".repeat(14)}`;
const WEBHOOK_SECRET = "whsec_cf7integrationsecret0123456789";

function event(id: string, livemode = false, type = "invoice.paid"): string {
  return JSON.stringify({ id, object: "event", type, livemode, data: {} });
}

function delivery(
  body: string,
  secret = WEBHOOK_SECRET,
  timestamp?: number,
): Request {
  return new Request(`http://localhost${STRIPE_WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signStripePayload(body, secret, timestamp),
    },
    body,
  });
}

describeDatabase("CF7: Stripe Connect gateway", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const owner = { userId: OWNER, platformRole: "owner" as const };
  const billing = { userId: BILLING, platformRole: "billing" as const };
  const operations = {
    userId: OPERATIONS,
    platformRole: "operations" as const,
  };
  const asUser = <T>(
    userId: string,
    op: (tx: ContextTransaction) => Promise<T>,
  ) => withIdentityContext(prisma, userId, op);

  async function cleanup() {
    await admin.$executeRawUnsafe(`delete from public.payment_webhook_events`);
    await admin.$executeRawUnsafe(`delete from public.payment_gateways`);
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_members where user_id in ('${BILLING}', '${OPERATIONS}')`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status) values
         ('${BILLING}', 'billing', 'active'), ('${OPERATIONS}', 'operations', 'active')`,
    );
  });

  beforeEach(async () => {
    await admin.$executeRawUnsafe(`delete from public.payment_webhook_events`);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("is off by default, and operations neither reads nor writes it", async () => {
    const view = await asUser(OWNER, (tx) => getStripeGateway(tx, owner));
    expect(view).toMatchObject({
      enabled: false,
      isDefault: false,
      mode: "test",
      secretKeyMasked: null,
    });
    await expect(
      asUser(OPERATIONS, (tx) => getStripeGateway(tx, operations)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // RLS repeats it even when the service is skipped.
    const rows = await asUser(OPERATIONS, (tx) => tx.paymentGateway.findMany());
    expect(rows).toHaveLength(0);
  });

  it("refuses to turn on without credentials and a key of the other mode", async () => {
    await expect(
      asUser(BILLING, (tx) =>
        saveStripeSettings(tx, billing, {
          enabled: true,
          isDefault: false,
          mode: "test",
        }),
      ),
    ).rejects.toMatchObject({
      messageKey: "gateway.errors.credentialsRequired",
    });
    await expect(
      asUser(BILLING, (tx) =>
        saveStripeCredentials(tx, billing, {
          secretKey: `sk_live_${"9z".repeat(14)}`,
          webhookSecret: null,
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "gateway.errors.secretKeyMode" });
  });

  it("stores the credentials encrypted and shows them masked only", async () => {
    await asUser(BILLING, (tx) =>
      saveStripeCredentials(tx, billing, {
        secretKey: SECRET_KEY,
        webhookSecret: WEBHOOK_SECRET,
      }),
    );
    const view = await asUser(OWNER, (tx) => getStripeGateway(tx, owner));
    expect(view.secretKeyMasked).toBe("sk_test_...9z9z");
    expect(view.webhookSecretMasked).toBe("whsec_...6789");
    expect(JSON.stringify(view)).not.toContain(SECRET_KEY);
    const raw = await admin.paymentGateway.findUniqueOrThrow({
      where: { provider: "stripe" },
    });
    expect(raw.secretKeyEncrypted).not.toContain(SECRET_KEY);
    expect(raw.webhookSecretEncrypted).not.toContain(WEBHOOK_SECRET);
    await asUser(BILLING, (tx) =>
      saveStripeSettings(tx, billing, {
        enabled: true,
        isDefault: true,
        mode: "test",
      }),
    );
    // The mode must match the saved key.
    await expect(
      asUser(BILLING, (tx) =>
        saveStripeSettings(tx, billing, {
          enabled: true,
          isDefault: true,
          mode: "live",
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "gateway.errors.secretKeyMode" });
    expect(
      (await asUser(OWNER, (tx) => loadTestWebhookSecret(tx, owner))).secret,
    ).toBe(WEBHOOK_SECRET);
  });

  it("stores a signed event once and answers repeats with no second effect", async () => {
    const body = event("evt_cf7_once");
    const first = await receiveStripeWebhook(prisma, delivery(body));
    expect(first).toEqual({
      status: 200,
      body: { received: true, duplicate: false, status: "processed" },
    });
    const repeat = await receiveStripeWebhook(prisma, delivery(body));
    expect(repeat).toEqual({
      status: 200,
      body: { received: true, duplicate: true },
    });
    const rows = await admin.paymentWebhookEvent.findMany({
      where: { eventId: "evt_cf7_once" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "processed",
      attempts: 1,
      rawBody: body,
      eventType: "invoice.paid",
    });
  });

  it("stores nothing for a wrong, expired or missing signature", async () => {
    const body = event("evt_cf7_bad");
    expect(
      (
        await receiveStripeWebhook(
          prisma,
          delivery(body, "whsec_wrongsecret0123456789"),
        )
      ).status,
    ).toBe(400);
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(
      (await receiveStripeWebhook(prisma, delivery(body, WEBHOOK_SECRET, old)))
        .status,
    ).toBe(400);
    const unsigned = new Request(`http://localhost${STRIPE_WEBHOOK_PATH}`, {
      method: "POST",
      body,
    });
    expect((await receiveStripeWebhook(prisma, unsigned)).status).toBe(400);
    expect(await admin.paymentWebhookEvent.count()).toBe(0);
  });

  it("keeps an event of the other mode as failed and reprocesses it idempotently", async () => {
    const live = event("evt_cf7_live", true);
    const result = await receiveStripeWebhook(prisma, delivery(live));
    expect(result.body).toMatchObject({ status: "failed" });
    // Stripe's retry of a failed event processes it again (still failing).
    await receiveStripeWebhook(prisma, delivery(live));
    const failed = await admin.paymentWebhookEvent.findFirstOrThrow({
      where: { eventId: "evt_cf7_live" },
    });
    expect(failed).toMatchObject({
      status: "failed",
      attempts: 2,
      lastError: "mode_mismatch",
    });

    let health = await asUser(BILLING, (tx) => webhookHealth(tx, billing));
    expect(health).toMatchObject({ received: 1, failed: 1, processed: 0 });
    expect(health.lastReceivedAt).not.toBeNull();
    expect(health.averageMs).not.toBeNull();

    // Still the test mode: the reprocessing fails again.
    expect(
      await asUser(BILLING, (tx) => reprocessFailedEvents(tx, billing)),
    ).toEqual({ processed: 0, failed: 1 });

    // In live mode (with a live key), it goes through, and only once.
    await asUser(BILLING, (tx) =>
      saveStripeSettings(tx, billing, {
        enabled: false,
        isDefault: false,
        mode: "test",
      }),
    );
    await admin.$executeRawUnsafe(
      `update public.payment_gateways set mode = 'live', secret_key_masked = 'sk_live_...9z9z', enabled = true`,
    );
    expect(
      await asUser(OWNER, (tx) => reprocessFailedEvents(tx, owner)),
    ).toEqual({ processed: 1, failed: 0 });
    expect(
      await asUser(OWNER, (tx) => reprocessFailedEvents(tx, owner)),
    ).toEqual({ processed: 0, failed: 0 });
    health = await asUser(BILLING, (tx) => webhookHealth(tx, billing));
    expect(health).toMatchObject({ received: 1, failed: 0, processed: 1 });
    await admin.$executeRawUnsafe(
      `update public.payment_gateways set mode = 'test', secret_key_masked = 'sk_test_...9z9z'`,
    );
  });

  it("marks the application's own test event and keeps no customer data", async () => {
    const body = buildTestEvent("test");
    const result = await receiveStripeWebhook(prisma, delivery(body));
    expect(result.status).toBe(200);
    const row = await admin.paymentWebhookEvent.findFirstOrThrow();
    expect(row).toMatchObject({ isTest: true, status: "processed" });
  });

  it("answers 404 and stores nothing while the gateway is off", async () => {
    await asUser(OWNER, (tx) =>
      saveStripeSettings(tx, owner, {
        enabled: false,
        isDefault: false,
        mode: "test",
      }),
    );
    const result = await receiveStripeWebhook(
      prisma,
      delivery(event("evt_cf7_off")),
    );
    expect(result.status).toBe(404);
    expect(await admin.paymentWebhookEvent.count()).toBe(0);
    await expect(
      asUser(OWNER, (tx) => loadTestWebhookSecret(tx, owner)),
    ).rejects.toMatchObject({ messageKey: "gateway.errors.notEnabled" });
  });

  it("lists the history from the audit trail, for owner and billing only", async () => {
    const history = await asUser(BILLING, (tx) => gatewayHistory(tx, billing));
    const actions = history.map((row) => row.action);
    expect(actions).toContain("platform.billing.gateway.settings");
    expect(actions).toContain("platform.billing.gateway.credentials");
    expect(actions).toContain("platform.billing.gateway.reprocess");
    const credentials = history.find(
      (row) => row.action === "platform.billing.gateway.credentials",
    );
    expect(credentials?.fields).toEqual(["secretKey", "webhookSecret"]);
    expect(JSON.stringify(history)).not.toContain("whsec_cf7");
    const none = await asUser(
      OPERATIONS,
      (tx) =>
        tx.$queryRaw<
          unknown[]
        >`select * from private.payment_gateway_history(20)`,
    );
    expect(none).toHaveLength(0);
  });
});
