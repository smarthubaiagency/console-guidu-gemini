import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/core/credentials/crypto";
import { dispatchEvent } from "@/core/events/dispatch";
import {
  contextPartnerId,
  emitEvent,
  EVENTS_DISPATCH_JOB_KIND,
  WORKER_ACTOR,
} from "@/core/events/emit";
import {
  listPlatformEvents,
  platformEventDetail,
  readEventData,
  setKeychain,
} from "@/core/events/platform";
import { EventsKeyMissingError } from "@/core/events/seal";
import {
  type EventSealRow,
  verifyEventChains,
  verifyEventRow,
} from "@/core/events/verify";
import { signWebhookBody } from "@/core/events/whatsapp";
import type {
  NotificationTransport,
  OutboundMessage,
} from "@/core/notifications/types";
import {
  type ContextTransaction,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * H1: the Event Hub end to end on the database. `emitEvent` seals and
 * chains as the worker and as the web (with the web's policies);
 * `events.dispatch` tells the recipients by the route (standard and
 * managed company) and posts the WhatsApp by the partner's webhook; the
 * daily check finds a tampered event; the platform reads the situation and
 * opens the data only with keychain.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const HOUSE = "00000000-0000-4000-8000-000000000000";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const OPERATIONS = "d0000000-0000-4000-8000-000000000010";
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const partnerSupport = "d0000000-0000-4000-8000-000000000006";
const partnerFinance = "d0000000-0000-4000-8000-000000000008";
const ownerS = "d0000000-0000-4000-8000-000000000007";
const adminS = "d0000000-0000-4000-8000-000000000002";

describeDatabase("H1: Event Hub", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });
  // Unique per run: companies with audit are never deleted.
  const run = Date.now().toString(36);
  const partnerId = randomUUID();
  const orgM = randomUUID();
  const wsM = randomUUID();
  const orgS = randomUUID();
  const wsS = randomUUID();

  const sent: OutboundMessage[] = [];
  const transport: NotificationTransport = {
    provider: "test",
    async send(message) {
      sent.push(message);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
    workerDb.$transaction((tx) => fn(tx as unknown as ContextTransaction));

  const keyEvent = (workspaceId: string, organizationId: string, key: string) =>
    asWorker((tx) =>
      emitEvent(tx, {
        type: "ai.agent.key_backup",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId,
        workspaceId,
        subject: { type: "ai_agent", id: randomUUID() },
        data: {
          workspaceName: "Loja H1",
          agentName: null,
          backupUntil: "2026-10-17T12:00:00.000Z",
          credentialsUrl:
            "https://app.guidu.test/app/loja/settings/credentials",
        },
        idempotencyKey: `h1-test:${run}:${key}`,
      }),
    );

  async function sealRow(id: string): Promise<EventSealRow & { seq: bigint }> {
    const [row] = await admin.$queryRawUnsafe<
      (EventSealRow & { seq: bigint })[]
    >(
      `select id, type, partner_id, organization_id, workspace_id, subject_type, subject_id,
              created_by, occurred_at, data, prev_hash, content_hash, key_version, seq
       from public.events where id = '${id}'`,
    );
    return row!;
  }

  beforeAll(async () => {
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-h1-${run}', 'Agência H1')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerId}', '${partnerOwner}', 'dono-${run}@agencia-h1.test', 'partner_owner'),
        ('${partnerId}', '${partnerSupport}', 'suporte-${run}@agencia-h1.test', 'partner_support'),
        ('${partnerId}', '${partnerFinance}', 'fin-${run}@agencia-h1.test', 'partner_finance')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organizations (id, name, status, partner_id) values
        ('${orgM}', 'Gerenciada H1 ${run}', 'active', '${partnerId}'),
        ('${orgS}', 'Padrão H1 ${run}', 'active', '${partnerId}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspaces (id, organization_id, slug, name, status) values
        ('${wsM}', '${orgM}', 'h1-m-${run}', 'Gerenciada', 'active'),
        ('${wsS}', '${orgS}', 'h1-s-${run}', 'Padrão', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
        ('${wsS}', '${orgS}', '${ownerS}', 'owner', 'active'),
        ('${wsS}', '${orgS}', '${adminS}', 'admin', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.invitations (organization_id, workspace_id, email, role, token_hash,
         invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id) values
        ('${orgS}', '${wsS}', 'dono-${run}@padrao.test', 'owner', 'h1-${run}', '${ownerS}',
         'accepted', now() + interval '1 day', now(), '${ownerS}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organization_service_modes (organization_id, partner_id, mode) values
        ('${orgM}', '${partnerId}', 'gerenciado'), ('${orgS}', '${partnerId}', 'padrao')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status)
       values ('${OPERATIONS}', 'operations', 'active')
       on conflict (user_id) do update set role = 'operations', status = 'active'`,
    );
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_capabilities where user_id = '${OPERATIONS}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_members where user_id = '${OPERATIONS}'`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("seals and chains each event once per key, as the worker", async () => {
    const first = await asWorker((tx) =>
      emitEvent(tx, {
        type: "billing.subscription.past_due",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgS,
        subject: { type: "subscription", id: randomUUID() },
        data: { partnerName: "Agência H1", periodEnd: "2026-10-01" },
        idempotencyKey: `h1-test:${run}:billing-1`,
      }),
    );
    expect(first.created).toBe(true);
    const again = await asWorker((tx) =>
      emitEvent(tx, {
        type: "billing.subscription.past_due",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgS,
        data: { partnerName: "Outro" },
        idempotencyKey: `h1-test:${run}:billing-1`,
      }),
    );
    expect(again).toEqual({ id: first.id, created: false });
    const second = await asWorker((tx) =>
      emitEvent(tx, {
        type: "billing.subscription.suspended",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgS,
        data: { partnerName: "Agência H1" },
        idempotencyKey: `h1-test:${run}:billing-2`,
      }),
    );
    const a = await sealRow(first.id);
    const b = await sealRow(second.id);
    expect(a).toMatchObject({ seq: 1n, prev_hash: null, key_version: "k1" });
    expect(b.seq).toBe(2n);
    expect(b.prev_hash).toBe(a.content_hash);
    expect(verifyEventRow(a)).toBe("ok");
    expect(verifyEventRow(b)).toBe("ok");
    // The dispatch of each was queued in the same transaction.
    expect(
      await admin.jobRun.count({
        where: {
          kind: EVENTS_DISPATCH_JOB_KIND,
          idempotencyKey: { in: [`event:${first.id}`, `event:${second.id}`] },
        },
      }),
    ).toBe(2);
    // Out of scope for the type's level, and unknown types, are refused.
    await expect(
      asWorker((tx) =>
        emitEvent(tx, {
          type: "billing.subscription.past_due",
          actor: WORKER_ACTOR,
          data: {},
          idempotencyKey: `h1-test:${run}:no-partner`,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("emits from the web for the context's workspace, and never unsealed", async () => {
    const emitted = await withContext(
      prisma,
      { ...contextA, partnerId: HOUSE },
      async (tx) =>
        emitEvent(tx, {
          type: "google_business.analyses_done",
          actor: { userId: ids.userA, principalType: "user", origin: "app" },
          partnerId: await contextPartnerId(tx),
          organizationId: ids.organizationA,
          workspaceId: ids.workspaceA,
          recipientUserId: ids.userA,
          data: { location: "Ficha H1", failed: "0" },
          idempotencyKey: `h1-test:${run}:web`,
        }),
    );
    expect(emitted.created).toBe(true);
    const row = await sealRow(emitted.id);
    expect(row).toMatchObject({ partner_id: HOUSE, created_by: ids.userA });
    expect(verifyEventRow(row)).toBe("ok");
    // Another company's partner is refused by the database.
    await expect(
      withContext(prisma, contextA, (tx) =>
        emitEvent(tx, {
          type: "google_business.analyses_done",
          actor: { userId: ids.userA, principalType: "user", origin: "app" },
          partnerId,
          organizationId: ids.organizationA,
          workspaceId: ids.workspaceA,
          recipientUserId: ids.userA,
          data: {},
          idempotencyKey: `h1-test:${run}:web-forged`,
        }),
      ),
    ).rejects.toThrow();
    vi.stubEnv("EVENTS_HMAC_KEY", "");
    try {
      await expect(keyEvent(wsS, orgS, "no-key")).rejects.toBeInstanceOf(
        EventsKeyMissingError,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("tells the customer in the standard mode and the partner in the managed one", async () => {
    const standard = await keyEvent(wsS, orgS, "standard");
    const managed = await keyEvent(wsM, orgM, "managed");
    const resultS = await asWorker((tx) =>
      dispatchEvent(tx, standard.id, { transport }),
    );
    const resultM = await asWorker((tx) =>
      dispatchEvent(tx, managed.id, { transport }),
    );
    expect(resultS).toMatchObject({
      status: "dispatched",
      notices: 1,
      bell: 1,
    });
    expect(resultM).toMatchObject({ status: "dispatched", notices: 2 });
    expect(sent.map((m) => m.to).sort()).toEqual([
      `dono-${run}@agencia-h1.test`,
      `dono-${run}@padrao.test`,
      `suporte-${run}@agencia-h1.test`,
    ]);
    // The partner's brand and sender; finance never hears.
    expect(sent.every((m) => m.subject.length > 0)).toBe(true);
    const bell = await admin.userNotification.findMany({
      where: { idempotencyKey: { startsWith: `h1-test:${run}:` } },
    });
    expect(bell.map((n) => n.userId).sort()).toEqual(
      [adminS, ownerS, partnerOwner, partnerSupport].sort(),
    );
    const deliveries = await admin.notificationDelivery.findMany({
      where: { eventId: { in: [standard.id, managed.id] } },
    });
    expect(deliveries).toHaveLength(3);
    expect(
      deliveries.every(
        (d) =>
          d.channel === "email" && d.status === "sent" && d.provider === "test",
      ),
    ).toBe(true);
    expect(
      deliveries.find((d) => d.eventId === standard.id)?.recipientUserId,
    ).toBe(ownerS);
    // Done once: the queued job finds nothing left.
    await expect(
      asWorker((tx) => dispatchEvent(tx, standard.id, { transport })),
    ).resolves.toMatchObject({ status: "done" });
    expect(sent).toHaveLength(3);
  });

  it("posts the WhatsApp by the partner's webhook, signed, or keeps why not", async () => {
    const whatsapp = (key: string, target: Record<string, unknown>) =>
      asWorker((tx) =>
        emitEvent(tx, {
          type: "ai.agent.referral_recommended",
          actor: WORKER_ACTOR,
          partnerId,
          organizationId: orgS,
          workspaceId: wsS,
          data: { whatsapp: target },
          idempotencyKey: `h1-test:${run}:wa-${key}`,
        }),
      );
    const posts: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string | URL, init: RequestInit = {}) => {
      posts.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    const deliver = (id: string) =>
      asWorker((tx) => dispatchEvent(tx, id, { fetch }));
    const stateOf = async (id: string) =>
      admin.notificationDelivery.findFirstOrThrow({
        where: { eventId: id, channel: "whatsapp" },
      });

    const before = await whatsapp("before", {
      to: "+5511900000000",
      message: { text: "Olá" },
    });
    await expect(deliver(before.id)).resolves.toMatchObject({
      whatsapp: "skipped",
    });
    expect(await stateOf(before.id)).toMatchObject({
      status: "skipped",
      reason: "no_webhook",
      attempts: 0,
    });

    const secret = `segredo-h1-${run}-webhook`;
    const sealed = encryptSecret(secret);
    await admin.partnerNoticeWebhook.create({
      data: {
        partnerId,
        url: "https://198.51.100.30/h1",
        maskedSecret: sealed.maskedValue,
        encryptedSecret: sealed.encryptedPayload,
        updatedBy: partnerOwner,
      },
    });
    const ok = await whatsapp("ok", {
      to: "+5511900000000",
      message: { text: "Indicação", notice_id: "n-1" },
    });
    await expect(deliver(ok.id)).resolves.toMatchObject({ whatsapp: "sent" });
    expect(posts).toHaveLength(1);
    const headers = new Headers(posts[0]!.init.headers);
    const body = String(posts[0]!.init.body);
    expect(headers.get("x-guidu-event")).toBe("ai.agent.referral_recommended");
    expect(headers.get("x-guidu-signature")).toBe(
      signWebhookBody(secret, headers.get("x-guidu-timestamp") ?? "", body),
    );
    expect(JSON.parse(body)).toMatchObject({
      event: "ai.agent.referral_recommended",
      event_id: ok.id,
      to: "+5511900000000",
      text: "Indicação",
      notice_id: "n-1",
    });
    expect(await stateOf(ok.id)).toMatchObject({
      status: "sent",
      provider: "partner_webhook",
      attempts: 1,
      recipientEmail: null,
    });

    const noNumber = await whatsapp("no-number", { to: null, message: {} });
    await deliver(noNumber.id);
    expect(await stateOf(noNumber.id)).toMatchObject({
      status: "skipped",
      reason: "no_recipient",
    });
    const told = await whatsapp("skip", {
      to: null,
      skip: "email_provider_pending",
      message: {},
    });
    await deliver(told.id);
    expect(await stateOf(told.id)).toMatchObject({
      status: "skipped",
      reason: "email_provider_pending",
    });
    expect(posts).toHaveLength(1);
  });

  it("finds a tampered event and raises the chain alarm once", async () => {
    const first = await keyEvent(wsM, orgM, "chain-1");
    const second = await keyEvent(wsM, orgM, "chain-2");
    // Someone with database access changes the data of the first event.
    await admin.$executeRawUnsafe(
      `update public.events set data = jsonb_set(data, '{workspaceName}', '"Forjada"') where id = '${first.id}'`,
    );
    const result = await asWorker((tx) => verifyEventChains(tx));
    expect(result.newlyBroken).toBeGreaterThanOrEqual(1);
    const states = await admin.$queryRawUnsafe<
      { id: string; integrity: string }[]
    >(
      `select id, integrity from public.events where id in ('${first.id}', '${second.id}')`,
    );
    expect(Object.fromEntries(states.map((s) => [s.id, s.integrity]))).toEqual({
      [first.id]: "broken",
      // Its own seal and link are intact: the next event still verifies.
      [second.id]: "ok",
    });
    const audits = await admin.auditEvent.count({
      where: { action: "platform.events.chain_broken", resourceId: first.id },
    });
    expect(audits).toBe(1);
    const [alarm] = await admin.$queryRawUnsafe<
      { data: { eventIds: string[] } }[]
    >(
      `select data from public.events where type = 'platform.events.chain_broken'
       and data -> 'eventIds' ? '${first.id}'`,
    );
    expect(alarm?.data.eventIds).toContain(first.id);
    // Already known: no second audit.
    await asWorker((tx) => verifyEventChains(tx));
    expect(
      await admin.auditEvent.count({
        where: { action: "platform.events.chain_broken", resourceId: first.id },
      }),
    ).toBe(audits);
  });

  it("shows the platform the situation, and the data only with keychain", async () => {
    const event = await keyEvent(wsS, orgS, "platform");
    const owner = { userId: PLATFORM_OWNER, platformRole: "owner" as const };
    const operations = {
      userId: OPERATIONS,
      platformRole: "operations" as const,
    };
    const list = await withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
      listPlatformEvents(tx, owner, { customer: orgS }),
    );
    expect(list.map((row) => row.id)).toContain(event.id);
    const detail = await withIdentityContext(prisma, OPERATIONS, (tx) =>
      platformEventDetail(tx, operations, event.id),
    );
    expect(detail).toMatchObject({
      id: event.id,
      organizationName: `Padrão H1 ${run}`,
      chainOk: true,
    });
    expect(detail).not.toHaveProperty("data");

    // Without keychain, refused; the owner grants it, then the data opens.
    const view = () =>
      withIdentityContext(prisma, OPERATIONS, (tx) =>
        readEventData(tx, operations, {
          eventId: event.id,
          reason: "Chamado 77 do cliente",
          ip: "203.0.113.7",
        }),
      );
    await expect(view()).rejects.toMatchObject({ code: "forbidden" });
    await withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
      setKeychain(tx, owner, OPERATIONS, true),
    );
    await expect(view()).resolves.toMatchObject({ workspaceName: "Loja H1" });
    await expect(
      withIdentityContext(prisma, OPERATIONS, (tx) =>
        readEventData(tx, operations, {
          eventId: event.id,
          reason: "curto",
          ip: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const audit = await admin.auditEvent.findFirstOrThrow({
      where: { action: "platform.event.view_data", resourceId: event.id },
    });
    expect(audit).toMatchObject({
      actorUserId: OPERATIONS,
      organizationId: null,
      workspaceId: null,
      origin: "admin",
    });
    expect(audit.metadata).toMatchObject({ reason: "Chamado 77 do cliente" });
    expect(
      await admin.auditEvent.count({
        where: {
          action: "platform.capability.grant",
          resourceId: OPERATIONS,
          actorUserId: PLATFORM_OWNER,
        },
      }),
    ).toBeGreaterThanOrEqual(1);
    // Operations cannot grant.
    await expect(
      withIdentityContext(prisma, OPERATIONS, (tx) =>
        setKeychain(tx, operations, OPERATIONS, false),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
