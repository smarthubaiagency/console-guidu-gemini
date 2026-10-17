import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/core/credentials/crypto";
import {
  decideEventAccess,
  readEventDataByGrant,
  requestEventAccess,
} from "@/core/events/access";
import { dispatchEvent } from "@/core/events/dispatch";
import { emitEvent, WORKER_ACTOR } from "@/core/events/emit";
import {
  emitAccessRequest,
  escalatePending,
  expireAccessGrants,
  releaseQuietWhatsApp,
  sendDigests,
} from "@/core/events/notices";
import { eventTrace } from "@/core/events/views";
import {
  restoreTemplateDefault,
  saveTemplateVersion,
  templateVersions,
} from "@/core/events/whatsapp-templates";
import type {
  NotificationTransport,
  OutboundMessage,
} from "@/core/notifications/types";
import {
  type ContextTransaction,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * H2 end to end on the database: the rules of the cascade in the dispatch
 * (off by default for security, channels, WhatsApp to people with an
 * accepted number), the quiet window and the digest of the tick, the
 * escalation of an approval nobody answered, the access to the data of an
 * event (request → event of the hub → decision → audited read → trace),
 * the grant expiry and the versioned WhatsApp texts.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const ownerS = "d0000000-0000-4000-8000-000000000007";
const adminS = "d0000000-0000-4000-8000-000000000002";

// Wednesday 2026-10-14, 10:00 and 21:00 in São Paulo.
const DAY = new Date("2026-10-14T13:00:00Z");
const NIGHT = new Date("2026-10-15T00:00:00Z");

describeDatabase("H2: event rules and access", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });
  const run = Date.now().toString(36);
  const partnerId = randomUUID();
  const orgS = randomUUID();
  const wsS = randomUUID();
  const ctxS = { userId: ownerS, workspaceId: wsS, organizationId: orgS };

  const sent: OutboundMessage[] = [];
  const transport: NotificationTransport = {
    provider: "test",
    async send(message) {
      sent.push(message);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  const posts: { body: Record<string, unknown>; headers: Headers }[] = [];
  const fetch = (async (_url: string | URL, init: RequestInit = {}) => {
    posts.push({
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: new Headers(init.headers),
    });
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
  const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
    workerDb.$transaction((tx) => fn(tx as unknown as ContextTransaction));

  const emit = (
    type:
      | "security.api_key_created"
      | "security.api_key_revoked"
      | "security.mfa_requirement_off"
      | "google_business.analyses_done"
      | "events.access_requested",
    key: string,
    extra: Partial<Parameters<typeof emitEvent>[1]> = {},
  ) =>
    asWorker((tx) =>
      emitEvent(tx, {
        type,
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgS,
        workspaceId: wsS,
        data: { workspaceName: "Loja H2", keyName: "Chave do ERP" },
        idempotencyKey: `h2-test:${run}:${key}`,
        ...extra,
      }),
    );

  async function setRules(value: unknown) {
    await admin.$executeRawUnsafe(
      `delete from public.settings where scope = 'workspace' and workspace_id = '${wsS}'
         and key = 'notifications.rules'`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.settings (scope, organization_id, workspace_id, key, value, updated_by)
       values ('workspace', '${orgS}', '${wsS}', 'notifications.rules', $1::jsonb, '${ownerS}')`,
      JSON.stringify(value),
    );
  }

  beforeAll(async () => {
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-h2-${run}', 'Agência H2')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerId}', '${partnerOwner}', 'dono-${run}@agencia-h2.test', 'partner_owner')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organizations (id, name, status, partner_id) values
        ('${orgS}', 'Padrão H2 ${run}', 'active', '${partnerId}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspaces (id, organization_id, slug, name, status) values
        ('${wsS}', '${orgS}', 'h2-s-${run}', 'Loja H2', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
        ('${wsS}', '${orgS}', '${ownerS}', 'owner', 'active'),
        ('${wsS}', '${orgS}', '${adminS}', 'admin', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.invitations (organization_id, workspace_id, email, role, token_hash,
         invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id) values
        ('${orgS}', '${wsS}', 'dono-${run}@padrao-h2.test', 'owner', 'h2-${run}', '${ownerS}',
         'accepted', now() + interval '1 day', now(), '${ownerS}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organization_service_modes (organization_id, partner_id, mode) values
        ('${orgS}', '${partnerId}', 'padrao')`,
    );
    const sealed = encryptSecret(`segredo-h2-${run}`);
    await admin.partnerNoticeWebhook.create({
      data: {
        partnerId,
        url: "https://198.51.100.31/h2",
        maskedSecret: sealed.maskedValue,
        encryptedSecret: sealed.encryptedPayload,
        updatedBy: partnerOwner,
      },
    });
    await admin.$executeRawUnsafe(
      `insert into public.user_whatsapp_numbers (user_id, phone, consented_at)
       values ('${ownerS}', '+5511912340000', now())
       on conflict (user_id) do update set phone = excluded.phone, consented_at = now()`,
    );
  });

  beforeEach(() => {
    sent.length = 0;
    posts.length = 0;
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      `delete from public.user_whatsapp_numbers where user_id = '${ownerS}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.whatsapp_templates where event_type = 'security.api_key_revoked'`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  const deliveriesOf = (eventId: string) =>
    admin.notificationDelivery.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
    });

  it("keeps the security notice off by default and follows the rule when on", async () => {
    const off = await emit("security.api_key_created", "sec-off");
    await expect(
      asWorker((tx) =>
        dispatchEvent(tx, off.id, { transport, fetch, now: () => DAY }),
      ),
    ).resolves.toMatchObject({ status: "skipped" });
    expect(await deliveriesOf(off.id)).toHaveLength(0);

    await setRules({
      "security.api_key_created": {
        enabled: true,
        channels: ["app", "whatsapp"],
      },
    });
    const on = await emit("security.api_key_created", "sec-on");
    await asWorker((tx) =>
      dispatchEvent(tx, on.id, { transport, fetch, now: () => DAY }),
    );
    const rows = await deliveriesOf(on.id);
    const byUser = Object.fromEntries(
      rows.map((d) => [`${d.channel}:${d.recipientUserId}`, d]),
    );
    expect(byUser[`whatsapp:${ownerS}`]).toMatchObject({
      status: "sent",
      provider: "partner_webhook",
    });
    expect(byUser[`whatsapp:${adminS}`]).toMatchObject({
      status: "skipped",
      reason: "no_whatsapp_consent",
    });
    expect(sent).toHaveLength(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({
      event: "security.api_key_created",
      event_id: on.id,
      to: "+5511912340000",
    });
    expect(String(posts[0]!.body.text)).toContain("Chave do ERP");
    const bell = await admin.userNotification.findMany({
      where: { eventId: on.id },
    });
    expect(bell.map((n) => n.userId).sort()).toEqual([adminS, ownerS].sort());
  });

  it("holds WhatsApp in the quiet window, lets urgent security through, releases later", async () => {
    await setRules({
      "security.api_key_created": { enabled: true, channels: ["whatsapp"] },
      "security.mfa_requirement_off": { enabled: true, channels: ["whatsapp"] },
    });
    const held = await emit("security.api_key_created", "quiet");
    await asWorker((tx) =>
      dispatchEvent(tx, held.id, { transport, fetch, now: () => NIGHT }),
    );
    const [queued] = (await deliveriesOf(held.id)).filter(
      (d) => d.recipientUserId === ownerS,
    );
    expect(queued).toMatchObject({
      status: "queued",
      holdReason: "quiet_hours",
    });
    expect(queued?.deliverAfter?.toISOString()).toBe(
      "2026-10-15T11:00:00.000Z",
    );
    expect(posts).toHaveLength(0);

    const urgent = await emit("security.mfa_requirement_off", "urgent");
    await asWorker((tx) =>
      dispatchEvent(tx, urgent.id, { transport, fetch, now: () => NIGHT }),
    );
    expect(posts.map((p) => p.body.event)).toEqual([
      "security.mfa_requirement_off",
    ]);

    // The window ended long ago (in the database's clock): the tick sends it.
    await expect(
      asWorker((tx) => releaseQuietWhatsApp(tx, { fetch })),
    ).resolves.toBeGreaterThanOrEqual(1);
    const mine = posts.filter((p) =>
      [held.id, urgent.id].includes(String(p.body.event_id)),
    );
    expect(mine.map((p) => p.body.event)).toEqual([
      "security.mfa_requirement_off",
      "security.api_key_created",
    ]);
    const [after] = (await deliveriesOf(held.id)).filter(
      (d) => d.recipientUserId === ownerS,
    );
    expect(after).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("keeps digest notices for the daily digest and sends one per person", async () => {
    await setRules({ "google_business.analyses_done": { delivery: "digest" } });
    const one = await emit("google_business.analyses_done", "digest-1", {
      recipientUserId: ownerS,
      data: { location: "Loja Centro" },
    });
    const two = await emit("google_business.analyses_done", "digest-2", {
      recipientUserId: ownerS,
      data: { location: "Loja Sul" },
    });
    for (const event of [one, two]) {
      await asWorker((tx) =>
        dispatchEvent(tx, event.id, { transport, fetch, now: () => DAY }),
      );
    }
    expect(
      await admin.userNotification.count({ where: { eventId: one.id } }),
    ).toBe(0);
    const queued = [
      ...(await deliveriesOf(one.id)),
      ...(await deliveriesOf(two.id)),
    ];
    expect(
      queued.every((d) => d.channel === "app" && d.status === "queued"),
    ).toBe(true);
    expect(queued[0]?.deliverAfter?.toISOString()).toBe(
      "2026-10-15T11:00:00.000Z",
    );

    await asWorker((tx) => sendDigests(tx, { transport, fetch }));
    const digest = await admin.userNotification.findMany({
      where: { userId: ownerS, eventType: "events.digest" },
      orderBy: { createdAt: "desc" },
    });
    expect(digest[0]?.data).toMatchObject({ count: "2" });
    const done = [
      ...(await deliveriesOf(one.id)),
      ...(await deliveriesOf(two.id)),
    ];
    expect(
      done.every((d) => d.status === "sent" && d.provider === "bell"),
    ).toBe(true);
  });

  it("reminds and escalates an approval nobody answered", async () => {
    await setRules({
      "events.access_requested": {
        escalate_after_hours: 4,
        escalate_to: ["owner"],
      },
    });
    const pending = await emit("events.access_requested", "pending", {
      status: "pending",
      data: { requester: "GUIDU", workspaceName: "Loja H2", hours: 72 },
    });
    await asWorker((tx) => dispatchEvent(tx, pending.id, { transport, fetch }));
    sent.length = 0;
    // Two hours later: nothing; ten hours later: reminder and escalation.
    const later = (hours: number) => () =>
      new Date(Date.now() + hours * 3_600_000);
    await asWorker((tx) => escalatePending(tx, { transport, now: later(2) }));
    expect(
      await admin.userNotification.count({
        where: {
          eventId: pending.id,
          eventType: { startsWith: "events." },
          NOT: { eventType: "events.access_requested" },
        },
      }),
    ).toBe(0);
    await asWorker((tx) => escalatePending(tx, { transport, now: later(10) }));
    await asWorker((tx) => escalatePending(tx, { transport, now: later(10) }));
    const notices = await admin.userNotification.findMany({
      where: {
        eventId: pending.id,
        eventType: { in: ["events.reminder", "events.escalation"] },
      },
    });
    expect(notices.map((n) => `${n.eventType}:${n.userId}`).sort()).toEqual(
      [
        `events.escalation:${ownerS}`,
        `events.reminder:${adminS}`,
        `events.reminder:${ownerS}`,
      ].sort(),
    );
    // Once per stage and person, whatever the number of ticks.
    expect(sent.map((m) => m.to).filter((to) => to.includes(run))).toEqual([
      `dono-${run}@padrao-h2.test`,
      `dono-${run}@padrao-h2.test`,
    ]);
  });

  it("asks, approves, reads with audit and shows the view in the trace", async () => {
    const target = await emit("security.api_key_created", "target", {
      data: { workspaceName: "Loja H2", keyName: "Segredo do cliente" },
    });
    const requester = {
      kind: "platform" as const,
      userId: PLATFORM_OWNER,
      platformRole: "owner" as const,
    };
    const grant = await withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
      requestEventAccess(tx, requester, {
        workspaceId: wsS,
        organizationId: orgS,
        eventIds: [target.id],
        reason: "Chamado 991 do cliente",
        reference: "CH-991",
        durationHours: 48,
      }),
    );
    expect(grant).toMatchObject({
      status: "pending",
      workspaceName: "Loja H2",
    });
    const job = await admin.jobRun.findFirst({
      where: {
        kind: "events.access-request",
        idempotencyKey: `access:${grant.id}`,
      },
    });
    expect(job).not.toBeNull();
    const eventId = await asWorker((tx) => emitAccessRequest(tx, grant.id));
    const [requestEvent] = await admin.$queryRawUnsafe<
      { status: string; data: Record<string, unknown> }[]
    >(`select status, data from public.events where id = '${eventId}'`);
    expect(requestEvent).toMatchObject({
      status: "pending",
      data: { requester: expect.any(String), reference: "CH-991", hours: 48 },
    });

    await expect(
      withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
        readEventDataByGrant(tx, requester, { eventId: target.id, ip: null }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    await withContext(prisma, ctxS, (tx) =>
      decideEventAccess(tx, ctxS, {
        grantId: grant.id,
        decision: "approve",
        hours: 24,
      }),
    );
    const [synced] = await admin.$queryRawUnsafe<{ status: string }[]>(
      `select status from public.events where id = '${eventId}'`,
    );
    expect(synced?.status).toBe("approved");

    await expect(
      withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
        readEventDataByGrant(tx, requester, {
          eventId: target.id,
          ip: "203.0.113.5",
        }),
      ),
    ).resolves.toMatchObject({ keyName: "Segredo do cliente" });

    const trace = await withContext(prisma, ctxS, (tx) =>
      eventTrace(tx, target.id),
    );
    expect(trace.viewer).toBe("customer");
    expect(trace.views).toEqual([
      expect.objectContaining({ requesterKind: "platform", decidedBy: ownerS }),
    ]);
    expect(trace.audit.map((a) => a.action)).toContain("event.data.viewed");

    // Past the term, the worker expires it and the read stops.
    await admin.$executeRawUnsafe(
      `update public.event_access_grants set expires_at = now() - interval '1 minute' where id = '${grant.id}'`,
    );
    await expect(
      asWorker((tx) => expireAccessGrants(tx)),
    ).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
        readEventDataByGrant(tx, requester, { eventId: target.id, ip: null }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("asks for several events of one workspace in one request (AJ1)", async () => {
    const first = await emit("security.api_key_created", "many-1", {
      data: { workspaceName: "Loja H2", keyName: "Primeira" },
    });
    const second = await emit("security.api_key_revoked", "many-2", {
      data: { workspaceName: "Loja H2", keyName: "Segunda" },
    });
    const requester = {
      kind: "platform" as const,
      userId: PLATFORM_OWNER,
      platformRole: "owner" as const,
    };
    const grant = await withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
      requestEventAccess(tx, requester, {
        workspaceId: wsS,
        organizationId: orgS,
        eventIds: [first.id, second.id, first.id],
        reason: "Chamado 992 do cliente",
        reference: "CH-992",
      }),
    );
    // One request, the events once each, 72 hours by default.
    expect(grant.eventIds.sort()).toEqual([first.id, second.id].sort());
    expect(grant.durationHours).toBe(72);
    const eventId = await asWorker((tx) => emitAccessRequest(tx, grant.id));
    const [requestEvent] = await admin.$queryRawUnsafe<
      { data: Record<string, unknown> }[]
    >(`select data from public.events where id = '${eventId}'`);
    expect(requestEvent?.data).toMatchObject({ count: 2 });
    await withContext(prisma, ctxS, (tx) =>
      decideEventAccess(tx, ctxS, { grantId: grant.id, decision: "approve" }),
    );
    for (const [id, keyName] of [
      [first.id, "Primeira"],
      [second.id, "Segunda"],
    ] as const) {
      await expect(
        withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
          readEventDataByGrant(tx, requester, { eventId: id, ip: null }),
        ),
      ).resolves.toMatchObject({ keyName });
    }

    // An event of another workspace never rides along.
    const elsewhere = await asWorker((tx) =>
      emitEvent(tx, {
        type: "security.api_key_created",
        actor: WORKER_ACTOR,
        partnerId: "00000000-0000-4000-8000-000000000000",
        organizationId: ids.organizationA,
        workspaceId: ids.workspaceA,
        data: { workspaceName: "Outro", keyName: "Outra" },
        idempotencyKey: `h2-test:${run}:many-elsewhere`,
      }),
    );
    await expect(
      withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
        requestEventAccess(tx, requester, {
          workspaceId: wsS,
          organizationId: orgS,
          eventIds: [first.id, elsewhere.id],
          reason: "Chamado 993 do cliente",
          reference: "CH-993",
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("versions the WhatsApp texts and validates their tags", async () => {
    const actor = {
      level: "platform" as const,
      userId: PLATFORM_OWNER,
      platformRole: "owner" as const,
    };
    const input = { eventType: "security.api_key_revoked", locale: "pt-BR" };
    const save = (body: string) =>
      withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
        saveTemplateVersion(tx, actor, { ...input, body }),
      );
    const first = await save("{{marca}}: chave {{chave}} revogada.");
    const second = await save(
      "{{marca}}: a chave {{chave}} foi revogada em {{workspace}}.",
    );
    expect(second).toBe(first + 1);
    await expect(save("{{marca}} {{senha}}")).rejects.toMatchObject({
      code: "invalid_input",
    });
    const versions = await withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
      templateVersions(tx, actor, input.eventType, input.locale),
    );
    expect(versions.map((v) => [v.version, v.isCurrent])).toEqual([
      [second, true],
      [first, false],
    ]);
    await withIdentityContext(prisma, PLATFORM_OWNER, (tx) =>
      restoreTemplateDefault(tx, actor, input),
    );
    const afterRestore = await withIdentityContext(
      prisma,
      PLATFORM_OWNER,
      (tx) => templateVersions(tx, actor, input.eventType, input.locale),
    );
    expect(afterRestore.every((v) => !v.isCurrent)).toBe(true);
    expect(afterRestore).toHaveLength(2);
  });
});
