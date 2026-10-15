import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deliverNotification } from "@/core/notifications/delivery";
import {
  markAllNoticesRead,
  markNoticeRead,
  myPreferences,
  postPartnerNotice,
  readInbox,
  saveMyPreference,
} from "@/core/notifications/inbox";
import type {
  NotificationEvent,
  NotificationTransport,
  OutboundMessage,
} from "@/core/notifications/types";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF3c: the bell and the preferences. The worker distributes an event to
 * the e-mail and to the recipient's bell, once per key; essential events
 * ignore preferences; each person reads and marks only their own notices.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const PARTNER = "c3c00000-0000-4000-8000-0000000000c1";
const OWNER = "d0000000-0000-4000-8000-000000000009";
const KEY = "cf3c-test:";

describeDatabase("CF3c: bell and preferences", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });

  const sent: OutboundMessage[] = [];
  const transport: NotificationTransport = {
    async send(message) {
      sent.push(message);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };

  const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
    workerDb.$transaction((tx) => fn(tx as unknown as ContextTransaction));
  const asUser = <T>(
    userId: string,
    fn: (tx: ContextTransaction) => Promise<T>,
  ) => withIdentityContext(prisma, userId, fn);

  const event = (suffix: string): NotificationEvent => ({
    type: "ai.agent.key_backup",
    recipientEmail: "dono-cf3c@cliente.test",
    idempotencyKey: `${KEY}${suffix}`,
    data: {
      workspaceName: "Loja CF3c",
      agentName: "Guia",
      backupUntil: new Date("2026-10-15T12:00:00Z"),
      credentialsUrl: "https://app.guidu.test/app/loja/settings/credentials",
    },
  });

  const deliver = (e: NotificationEvent, recipientUserId: string | null) =>
    asWorker((tx) =>
      deliverNotification(tx, {
        transport,
        language: { locale: "pt-BR" },
        event: e,
        brand: { name: "GUIDU", supportEmail: null, supportUrl: null },
        partnerId: PARTNER,
        relatedId: PARTNER,
        recipientUserId,
      }),
    );

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.user_notifications where idempotency_key like '${KEY}%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.notification_preferences where user_id in ('${ids.userA}', '${ids.userB}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${PARTNER}', 'agencia-cf3c-int', 'Agência CF3c')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${PARTNER}', '${OWNER}', 'dono@cf3c-int.test', 'partner_owner'),
        ('${PARTNER}', '${ids.userB}', 'fin@cf3c-int.test', 'partner_finance')`,
    );
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("delivers to the e-mail and the bell once per key", async () => {
    expect(await deliver(event("one"), ids.userA)).toBe(1);
    expect(await deliver(event("one"), ids.userA)).toBe(0);
    expect(sent.map((m) => m.to)).toEqual(["dono-cf3c@cliente.test"]);

    const delivery = await admin.notificationDelivery.findUniqueOrThrow({
      where: { idempotencyKey: `${KEY}one` },
    });
    expect(delivery).toMatchObject({ status: "sent", reason: null });

    const inbox = await asUser(ids.userA, (tx) => readInbox(tx, ids.userA));
    const notice = inbox.items.find(
      (n) => n.eventType === "ai.agent.key_backup",
    );
    expect(inbox.unread).toBeGreaterThanOrEqual(1);
    expect(notice).toMatchObject({
      linkUrl: "https://app.guidu.test/app/loja/settings/credentials",
      readAt: null,
      data: { workspace: "Loja CF3c", agent: "Guia" },
    });
    // Another person sees none of it.
    // Another person sees none of it, even asking for user A's notices (RLS).
    const other = await asUser(ids.userB, (tx) => readInbox(tx, ids.userA));
    expect(other).toEqual({ unread: 0, items: [] });
  });

  it("keeps an address without a known person to the e-mail only", async () => {
    expect(await deliver(event("address"), null)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(
      await admin.userNotification.count({
        where: { idempotencyKey: `${KEY}address` },
      }),
    ).toBe(0);
  });

  it("ignores a preference stored for an essential event", async () => {
    // Written as administrator: the screen refuses it (next test).
    await admin.$executeRawUnsafe(
      `insert into public.notification_preferences (user_id, event_type, channel, enabled) values
        ('${ids.userA}', 'ai.agent.key_backup', 'email', false),
        ('${ids.userA}', 'ai.agent.key_backup', 'app', false)`,
    );
    expect(await deliver(event("essential"), ids.userA)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(
      await admin.userNotification.count({
        where: { idempotencyKey: `${KEY}essential`, userId: ids.userA },
      }),
    ).toBe(1);
    await admin.$executeRawUnsafe(
      `delete from public.notification_preferences where user_id = '${ids.userA}'`,
    );
  });

  it("refuses to turn off an essential event or a channel it lacks", async () => {
    for (const input of [
      { eventType: "billing.subscription.past_due", channel: "email" },
      { eventType: "ai.agent.key_paused", channel: "app" },
      { eventType: "invitation.created", channel: "email" },
      { eventType: "ai.agent.key_backup", channel: "sms" },
    ]) {
      await expect(
        asUser(ids.userA, (tx) =>
          saveMyPreference(tx, ids.userA, { ...input, enabled: false }),
        ),
      ).rejects.toBeInstanceOf(AppError);
    }
    expect(
      await asUser(ids.userA, (tx) => myPreferences(tx, ids.userA)),
    ).toEqual([]);
  });

  it("marks one and then all of the person's notices as read", async () => {
    await deliver(event("two"), ids.userA);
    await deliver(event("three"), ids.userA);
    await deliver(event("b"), ids.userB);
    const before = await asUser(ids.userA, (tx) => readInbox(tx, ids.userA));
    const mine = before.items.filter((n) => n.readAt === null);
    expect(mine.length).toBeGreaterThanOrEqual(2);

    expect(
      await asUser(ids.userA, (tx) =>
        markNoticeRead(tx, ids.userA, mine[0]!.id),
      ),
    ).toBe(true);
    // Again is fine; someone else's notice is not found.
    expect(
      await asUser(ids.userA, (tx) =>
        markNoticeRead(tx, ids.userA, mine[0]!.id),
      ),
    ).toBe(true);
    const bNotice = await admin.userNotification.findUniqueOrThrow({
      where: { idempotencyKey: `${KEY}b` },
    });
    expect(
      await asUser(ids.userA, (tx) =>
        markNoticeRead(tx, ids.userA, bNotice.id),
      ),
    ).toBe(false);
    // Naming user B does not get past RLS either.
    expect(
      await asUser(ids.userA, (tx) =>
        markNoticeRead(tx, ids.userB, bNotice.id),
      ),
    ).toBe(false);

    const middle = await asUser(ids.userA, (tx) => readInbox(tx, ids.userA));
    expect(middle.unread).toBe(before.unread - 1);

    expect(
      await asUser(ids.userA, (tx) => markAllNoticesRead(tx, ids.userA)),
    ).toBe(middle.unread);
    expect(
      (await asUser(ids.userA, (tx) => readInbox(tx, ids.userA))).unread,
    ).toBe(0);
    // User B's notice stays unread.
    const b = await admin.userNotification.findUniqueOrThrow({
      where: { id: bNotice.id },
    });
    expect(b.readAt).toBeNull();
  });

  it("posts a partner's notice to its active owners only, once", async () => {
    const notice = {
      eventType: "billing.subscription.past_due",
      data: { organization: "Cliente", periodEnd: "2026-10-01" },
      linkUrl: "https://agencia.test/admin/billing",
    } as const;
    const first = await asWorker((tx) =>
      postPartnerNotice(tx, {
        partnerId: PARTNER,
        notice,
        idempotencyKey: `${KEY}partner`,
      }),
    );
    const again = await asWorker((tx) =>
      postPartnerNotice(tx, {
        partnerId: PARTNER,
        notice,
        idempotencyKey: `${KEY}partner`,
      }),
    );
    expect([first, again]).toEqual([1, 0]);
    const rows = await admin.userNotification.findMany({
      where: { idempotencyKey: { startsWith: `${KEY}partner` } },
    });
    expect(rows.map((r) => r.userId)).toEqual([OWNER]);
    expect(rows[0]?.idempotencyKey).toBe(`${KEY}partner:${OWNER}`);
  });
});
