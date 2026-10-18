import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/core/credentials/crypto";
import { MAX_EVENT_DEPTH } from "@/core/events/catalog";
import { dispatchEvent, runEventDispatch } from "@/core/events/dispatch";
import {
  emitEvent,
  EventChainLimitError,
  WORKER_ACTOR,
} from "@/core/events/emit";
import { type HandoffDeps, runHandoff } from "@/core/events/handoffs";
import { recoverStuckWhatsApp, runNoticesTick } from "@/core/events/notices";
import {
  defineSubscriber,
  type EventSubscriber,
} from "@/core/events/subscriber";
import { eventTrace } from "@/core/events/views";
import type {
  NotificationTransport,
  OutboundMessage,
} from "@/core/notifications/types";
import { expireProposals } from "@/core/proposals/expiry";
import {
  approveProposal,
  createAgentProposal,
  getProposal,
  rejectProposal,
} from "@/core/proposals/service";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * H4 end to end on the database: the hand-off of an event to its
 * subscribers (once, failures isolated and retried, module off, chain
 * limit), proposals through the hub (an agent's proposal, the managing
 * partner deciding in `gerenciado` while the customer follows, execution
 * by the subscriber `proposals.execute`, expiry by the tick) and the
 * WhatsApp in three steps with the recovery of a delivery left `sending`.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const partnerFinance = "d0000000-0000-4000-8000-000000000008";
const ownerS = "d0000000-0000-4000-8000-000000000007";
const ownerM = "d0000000-0000-4000-8000-000000000005";

// Wednesday 2026-10-14, 10:00 in São Paulo (outside the quiet window).
const DAY = new Date("2026-10-14T13:00:00Z");

describeDatabase("H4: hand-offs and approvals", requiredVars, () => {
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
  const orgM = randomUUID();
  const wsM = randomUUID();
  const memberS: RequestContext = {
    userId: ownerS,
    workspaceId: wsS,
    organizationId: orgS,
    partnerId,
    principalType: "user",
  };
  const customerM: RequestContext = {
    userId: ownerM,
    workspaceId: wsM,
    organizationId: orgM,
    partnerId,
    principalType: "user",
  };
  const partnerM: RequestContext = {
    userId: partnerOwner,
    workspaceId: wsM,
    organizationId: orgM,
    partnerId,
    principalType: "user",
  };

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

  const emitApproved = (key: string, extra: { causedBy?: string } = {}) =>
    asWorker((tx) =>
      emitEvent(tx, {
        type: "proposals.approved",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgS,
        workspaceId: wsS,
        subject: { type: "test", id: key },
        data: { proposalId: key },
        idempotencyKey: `h4-test:${run}:${key}`,
        ...extra,
      }),
    );

  /** Fake subscribers of `proposals.approved`, for the hand-off tests. */
  function subscribers(list: EventSubscriber[]): HandoffDeps {
    return {
      subscribersOf: (type) =>
        list.filter((s) => (s.eventTypes as readonly string[]).includes(type)),
      getSubscriber: (key) => list.find((s) => s.key === key) ?? null,
    };
  }

  const handoffsOf = (eventId: string) =>
    admin.$queryRawUnsafe<
      {
        subscriber: string;
        status: string;
        reason: string | null;
        attempts: number;
      }[]
    >(
      `select subscriber, status, reason, attempts from public.event_handoffs
       where event_id = $1::uuid order by subscriber`,
      eventId,
    );

  beforeAll(async () => {
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-h4-${run}', 'Agência H4')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerId}', '${partnerOwner}', 'dono-${run}@agencia-h4.test', 'partner_owner'),
        ('${partnerId}', '${partnerFinance}', 'fin-${run}@agencia-h4.test', 'partner_finance')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organizations (id, name, status, partner_id) values
        ('${orgS}', 'Padrão H4 ${run}', 'active', '${partnerId}'),
        ('${orgM}', 'Gerenciada H4 ${run}', 'active', '${partnerId}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspaces (id, organization_id, slug, name, status) values
        ('${wsS}', '${orgS}', 'h4-s-${run}', 'Loja H4', 'active'),
        ('${wsM}', '${orgM}', 'h4-m-${run}', 'Loja Gerenciada H4', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
        ('${wsS}', '${orgS}', '${ownerS}', 'owner', 'active'),
        ('${wsM}', '${orgM}', '${ownerM}', 'owner', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.invitations (organization_id, workspace_id, email, role, token_hash,
         invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id) values
        ('${orgS}', '${wsS}', 'dono-${run}@padrao-h4.test', 'owner', 'h4-${run}', '${ownerS}',
         'accepted', now() + interval '1 day', now(), '${ownerS}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organization_service_modes (organization_id, partner_id, mode) values
        ('${orgS}', '${partnerId}', 'padrao'),
        ('${orgM}', '${partnerId}', 'gerenciado')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by) values
        ('${orgM}', '${wsM}', 'crm', 'enabled', '${ownerM}')`,
    );
    const sealed = encryptSecret(`segredo-h4-${run}`);
    await admin.partnerNoticeWebhook.create({
      data: {
        partnerId,
        url: "https://198.51.100.41/h4",
        maskedSecret: sealed.maskedValue,
        encryptedSecret: sealed.encryptedPayload,
        updatedBy: partnerOwner,
      },
    });
    await admin.$executeRawUnsafe(
      `insert into public.user_whatsapp_numbers (user_id, phone, consented_at)
       values ('${ownerS}', '+5511912344444', now())
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
      `delete from public.crm_contacts where workspace_id = '${wsM}'`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("hands an event to each subscriber once, isolating a failure", async () => {
    const calls: string[] = [];
    let failing = true;
    const ok = defineSubscriber({
      key: "teste.registra",
      moduleKey: "core",
      eventTypes: ["proposals.approved"],
      description: "Registra a chamada.",
      async handle(_tx, event) {
        calls.push(`ok:${event.id}`);
      },
    });
    const broken = defineSubscriber({
      key: "teste.falha",
      moduleKey: "core",
      eventTypes: ["proposals.approved"],
      description: "Falha até ser consertado.",
      async handle(tx, event) {
        // Its writes are undone with the savepoint.
        await tx.$executeRaw`select 1`;
        if (failing) throw new Error("boom");
        calls.push(`fixed:${event.id}`);
      },
    });
    const deps = subscribers([ok, broken]);
    const event = await emitApproved("handoff");
    const first = await asWorker((tx) =>
      dispatchEvent(tx, event.id, { handoffs: deps }),
    );
    expect(first).toMatchObject({ status: "dispatched", handoffs: 2 });
    // Dispatching again adds nothing.
    await asWorker((tx) => dispatchEvent(tx, event.id, { handoffs: deps }));
    const jobs = await admin.jobRun.findMany({
      where: {
        kind: "events.subscriber",
        idempotencyKey: { startsWith: `event:${event.id}` },
      },
    });
    expect(jobs.map((j) => j.idempotencyKey).sort()).toEqual([
      `event:${event.id}:sub:teste.falha`,
      `event:${event.id}:sub:teste.registra`,
    ]);

    await asWorker((tx) => runHandoff(tx, event.id, "teste.registra", deps));
    await expect(
      asWorker((tx) => runHandoff(tx, event.id, "teste.falha", deps)),
    ).resolves.toMatchObject({ status: "failed", reason: "internal" });
    // A done hand-off never runs twice.
    await asWorker((tx) => runHandoff(tx, event.id, "teste.registra", deps));
    expect(calls).toEqual([`ok:${event.id}`]);
    expect(await handoffsOf(event.id)).toEqual([
      {
        subscriber: "teste.falha",
        status: "failed",
        reason: "internal",
        attempts: 1,
      },
      {
        subscriber: "teste.registra",
        status: "done",
        reason: null,
        attempts: 1,
      },
    ]);
    await admin.jobRun.findFirstOrThrow({
      where: {
        kind: "events.subscriber",
        idempotencyKey: `event:${event.id}:sub:teste.falha:retry:1`,
      },
    });

    // The follow-up run succeeds; after it, nothing runs again.
    failing = false;
    await asWorker((tx) => runHandoff(tx, event.id, "teste.falha", deps));
    await asWorker((tx) => runHandoff(tx, event.id, "teste.falha", deps));
    expect(calls).toEqual([`ok:${event.id}`, `fixed:${event.id}`]);
    expect((await handoffsOf(event.id))[0]).toMatchObject({
      status: "done",
      attempts: 2,
    });

    // The customer sees the hand-offs in the trace of the event.
    const trace = await withContext(prisma, memberS, (tx) =>
      eventTrace(tx, event.id),
    );
    expect(trace.handoffs.map((h) => `${h.subscriber}:${h.status}`)).toEqual([
      "teste.falha:done",
      "teste.registra:done",
    ]);
  });

  it("stops after 3 attempts", async () => {
    const always = defineSubscriber({
      key: "teste.sempre-falha",
      moduleKey: "core",
      eventTypes: ["proposals.approved"],
      description: "Sempre falha.",
      async handle() {
        throw new Error("sempre");
      },
    });
    const deps = subscribers([always]);
    const event = await emitApproved("attempts");
    await asWorker((tx) => dispatchEvent(tx, event.id, { handoffs: deps }));
    for (let i = 0; i < 4; i += 1) {
      await asWorker((tx) =>
        runHandoff(tx, event.id, "teste.sempre-falha", deps),
      );
    }
    expect(await handoffsOf(event.id)).toEqual([
      {
        subscriber: "teste.sempre-falha",
        status: "failed",
        reason: "internal",
        attempts: 3,
      },
    ]);
  });

  it("skips a subscriber whose module is off in the workspace", async () => {
    const calls: string[] = [];
    const crm = defineSubscriber({
      key: "crm.teste",
      moduleKey: "crm",
      eventTypes: ["proposals.approved"],
      description: "Do CRM.",
      async handle() {
        calls.push("crm");
      },
    });
    const deps = subscribers([crm]);
    const event = await emitApproved("module-off");
    await asWorker((tx) => dispatchEvent(tx, event.id, { handoffs: deps }));
    await asWorker((tx) => runHandoff(tx, event.id, "crm.teste", deps));
    expect(calls).toEqual([]);
    expect(await handoffsOf(event.id)).toEqual([
      {
        subscriber: "crm.teste",
        status: "skipped",
        reason: "module_disabled",
        attempts: 0,
      },
    ]);
  });

  it("refuses a sixth level of causes and hands nothing over at the last", async () => {
    const calls: string[] = [];
    const deps = subscribers([
      defineSubscriber({
        key: "teste.corrente",
        moduleKey: "core",
        eventTypes: ["proposals.approved"],
        description: "Re-emite.",
        async handle() {
          calls.push("run");
        },
      }),
    ]);
    let cause = (await emitApproved("chain-0")).id;
    for (let level = 1; level <= MAX_EVENT_DEPTH; level += 1) {
      cause = (await emitApproved(`chain-${level}`, { causedBy: cause })).id;
    }
    const [last] = await admin.$queryRawUnsafe<{ depth: number }[]>(
      `select depth from public.events where id = $1::uuid`,
      cause,
    );
    expect(Number(last?.depth)).toBe(MAX_EVENT_DEPTH);
    await expect(
      emitApproved("chain-6", { causedBy: cause }),
    ).rejects.toBeInstanceOf(EventChainLimitError);

    await asWorker((tx) => dispatchEvent(tx, cause, { handoffs: deps }));
    await asWorker((tx) => runHandoff(tx, cause, "teste.corrente", deps));
    expect(calls).toEqual([]);
    expect(await handoffsOf(cause)).toEqual([
      {
        subscriber: "teste.corrente",
        status: "skipped",
        reason: "chain_limit",
        attempts: 0,
      },
    ]);
    expect(
      await admin.jobRun.count({
        where: { idempotencyKey: `event:${cause}:sub:teste.corrente` },
      }),
    ).toBe(0);
  });

  it("lets the managing partner decide an agent's proposal and executes it through the hub", async () => {
    // A module's agent proposes, for the managing partner, from an event.
    const source = await asWorker((tx) =>
      emitEvent(tx, {
        type: "google_business.analyses_done",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgM,
        workspaceId: wsM,
        recipientUserId: ownerM,
        data: { location: "Loja Centro" },
        idempotencyKey: `h4-test:${run}:source`,
      }),
    );
    const { proposal } = await withContext(prisma, partnerM, (tx) =>
      createAgentProposal(tx, partnerM, source.id, {
        operation: "crm.contacts.create",
        payload: { name: `Agente H4 ${run}` },
        idempotencyKey: `h4-${run}-agent`,
        reason: "Lead da ficha",
      }),
    );
    expect(proposal).toMatchObject({
      status: "pending",
      origin: "agent",
      sourceEventId: source.id,
    });
    const ttl = proposal.expiresAt.getTime() - proposal.createdAt.getTime();
    expect(ttl).toBeGreaterThan(6.9 * 24 * 3_600_000);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 3_600_000 + 60_000);

    const [requested] = await admin.$queryRawUnsafe<
      {
        id: string;
        status: string;
        caused_by_event_id: string;
        depth: number;
        route: string;
      }[]
    >(
      `select id, status, caused_by_event_id, depth, route from public.events
       where type = 'proposals.requested' and subject_id = $1`,
      proposal.id,
    );
    expect(requested).toMatchObject({
      status: "pending",
      caused_by_event_id: source.id,
      depth: 1,
      route: "service_mode",
    });

    // The pending notice goes to the managing team, with the /admin link.
    await runEventDispatch(asWorker, requested!.id, {
      transport,
      fetch,
      now: () => DAY,
    });
    const bell = await admin.userNotification.findMany({
      where: { eventId: requested!.id },
    });
    expect(bell.map((n) => n.userId)).toEqual([partnerOwner]);
    expect(bell[0]?.linkUrl).toContain(
      `/admin/proposals?proposal=${proposal.id}`,
    );
    expect(sent.map((m) => m.to)).toEqual([`dono-${run}@agencia-h4.test`]);

    // The customer follows: reads, never decides.
    await expect(
      withContext(prisma, customerM, (tx) =>
        getProposal(tx, customerM, proposal.id),
      ),
    ).resolves.toMatchObject({ id: proposal.id });
    await expect(
      withContext(prisma, customerM, (tx) =>
        approveProposal(
          tx,
          customerM,
          proposal.id,
          { payloadHash: proposal.payloadHash },
          { mfaVerified: true },
        ),
      ),
    ).rejects.toThrow(/gerenciada/);
    // Finance of the partner does not decide either.
    const finance = { ...partnerM, userId: partnerFinance };
    await expect(
      withContext(prisma, finance, (tx) =>
        approveProposal(
          tx,
          finance,
          proposal.id,
          { payloadHash: proposal.payloadHash },
          { mfaVerified: true },
        ),
      ),
    ).rejects.toBeInstanceOf(Error);
    // Without MFA, refused.
    await expect(
      withContext(prisma, partnerM, (tx) =>
        approveProposal(
          tx,
          partnerM,
          proposal.id,
          { payloadHash: proposal.payloadHash },
          { mfaVerified: false },
        ),
      ),
    ).rejects.toBeInstanceOf(AppError);

    // The partner lists it from /admin (identity context, no workspace).
    const listed = await withIdentityContext(
      prisma,
      partnerOwner,
      (tx) => tx.executionProposal.findMany({ where: { id: proposal.id } }),
      { partnerId },
    );
    expect(listed).toHaveLength(1);

    const approved = await withContext(prisma, partnerM, (tx) =>
      approveProposal(
        tx,
        partnerM,
        proposal.id,
        { payloadHash: proposal.payloadHash },
        { mfaVerified: true },
      ),
    );
    expect(approved.status).toBe("approved");
    const [after] = await admin.$queryRawUnsafe<{ status: string }[]>(
      `select status from public.events where id = $1::uuid`,
      requested!.id,
    );
    expect(after?.status).toBe("approved");
    // No direct job anymore: the hub hands the execution over.
    expect(
      await admin.jobRun.count({
        where: {
          kind: "core.proposal-execute",
          idempotencyKey: `proposal:${proposal.id}`,
        },
      }),
    ).toBe(0);
    const [approvedEvent] = await admin.$queryRawUnsafe<
      { id: string; created_by: string }[]
    >(
      `select id, created_by from public.events where type = 'proposals.approved' and subject_id = $1`,
      proposal.id,
    );
    expect(approvedEvent?.created_by).toBe(partnerOwner);
    await runEventDispatch(asWorker, approvedEvent!.id, { transport, fetch });
    await expect(
      asWorker((tx) => runHandoff(tx, approvedEvent!.id, "proposals.execute")),
    ).resolves.toMatchObject({ status: "done", reason: null });

    const row = await admin.executionProposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    expect(row).toMatchObject({ status: "executed", decidedBy: partnerOwner });
    expect(
      await admin.crmContact.count({
        where: { workspaceId: wsM, name: `Agente H4 ${run}` },
      }),
    ).toBe(1);
    const [executed] = await admin.$queryRawUnsafe<
      { caused_by_event_id: string; created_by: string }[]
    >(
      `select caused_by_event_id, created_by from public.events
       where type = 'proposals.executed' and subject_id = $1`,
      proposal.id,
    );
    expect(executed).toMatchObject({
      caused_by_event_id: approvedEvent!.id,
      created_by: partnerOwner,
    });
    // Running the hand-off again does nothing.
    await asWorker((tx) =>
      runHandoff(tx, approvedEvent!.id, "proposals.execute"),
    );
    expect(
      await admin.crmContact.count({
        where: { workspaceId: wsM, name: `Agente H4 ${run}` },
      }),
    ).toBe(1);
  });

  it("follows a rejection and expires a proposal nobody decided", async () => {
    const source = await asWorker((tx) =>
      emitEvent(tx, {
        type: "google_business.analyses_done",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgM,
        workspaceId: wsM,
        recipientUserId: ownerM,
        data: { location: "Loja Sul" },
        idempotencyKey: `h4-test:${run}:source-2`,
      }),
    );
    const propose = (key: string) =>
      withContext(prisma, partnerM, (tx) =>
        createAgentProposal(tx, partnerM, source.id, {
          operation: "crm.contacts.create",
          payload: { name: `Vence ${key} ${run}` },
          idempotencyKey: `h4-${run}-${key}`,
        }),
      );
    const rejected = await propose("rejeitada");
    await withContext(prisma, partnerM, (tx) =>
      rejectProposal(tx, partnerM, rejected.proposal.id),
    );
    const statusOf = async (proposalId: string, type: string) =>
      (
        await admin.$queryRawUnsafe<{ status: string }[]>(
          `select status from public.events where type = $1 and subject_id = $2`,
          type,
          proposalId,
        )
      )[0]?.status ?? null;
    expect(await statusOf(rejected.proposal.id, "proposals.requested")).toBe(
      "denied",
    );
    expect(await statusOf(rejected.proposal.id, "proposals.rejected")).toBe(
      "open",
    );

    const late = await propose("vencida");
    await admin.$transaction([
      admin.$executeRawUnsafe(
        "alter table public.execution_proposals disable trigger execution_proposals_guard_update",
      ),
      admin.$executeRawUnsafe(
        `update public.execution_proposals set expires_at = now() - interval '1 minute' where id = '${late.proposal.id}'`,
      ),
      admin.$executeRawUnsafe(
        "alter table public.execution_proposals enable trigger execution_proposals_guard_update",
      ),
    ]);
    const result = await runNoticesTick(asWorker, { transport, fetch });
    expect(result.proposalsExpired).toBeGreaterThanOrEqual(1);
    await expect(asWorker((tx) => expireProposals(tx))).resolves.toBe(0);
    expect(
      (
        await admin.executionProposal.findUniqueOrThrow({
          where: { id: late.proposal.id },
        })
      ).status,
    ).toBe("expired");
    expect(await statusOf(late.proposal.id, "proposals.requested")).toBe(
      "expired",
    );
    expect(await statusOf(late.proposal.id, "proposals.expired")).toBe("open");
  });

  it("sends WhatsApp in three steps and takes back a delivery left sending", async () => {
    await admin.$executeRawUnsafe(
      `insert into public.settings (scope, organization_id, workspace_id, key, value, updated_by)
       values ('workspace', '${orgS}', '${wsS}', 'notifications.rules', $1::jsonb, '${ownerS}')`,
      JSON.stringify({
        "security.api_key_created": { enabled: true, channels: ["whatsapp"] },
      }),
    );
    const event = await asWorker((tx) =>
      emitEvent(tx, {
        type: "security.api_key_created",
        actor: WORKER_ACTOR,
        partnerId,
        organizationId: orgS,
        workspaceId: wsS,
        data: { workspaceName: "Loja H4", keyName: "ERP" },
        idempotencyKey: `h4-test:${run}:whatsapp`,
      }),
    );
    const delivery = () =>
      admin.notificationDelivery.findFirstOrThrow({
        where: {
          eventId: event.id,
          channel: "whatsapp",
          recipientUserId: ownerS,
        },
      });

    // Inside someone else's transaction the WhatsApp waits for a run.
    const deferred = await asWorker((tx) =>
      dispatchEvent(tx, event.id, { fetch, now: () => DAY }),
    );
    expect(deferred).toMatchObject({ whatsapp: "deferred", sends: [] });
    expect(posts).toHaveLength(0);
    await admin.jobRun.findFirstOrThrow({
      where: {
        kind: "events.dispatch",
        idempotencyKey: `event:${event.id}:whatsapp`,
      },
    });

    // Step 1 commits `sending`; the process dies before the POST.
    const claimed = await asWorker((tx) =>
      dispatchEvent(tx, event.id, { fetch, now: () => DAY, whatsapp: "claim" }),
    );
    expect(claimed.sends).toHaveLength(1);
    expect(await delivery()).toMatchObject({ status: "sending", attempts: 1 });
    // Not stuck yet: the tick leaves it.
    await expect(asWorker((tx) => recoverStuckWhatsApp(tx))).resolves.toBe(0);
    await admin.$executeRawUnsafe(
      `update public.notification_deliveries set sending_at = now() - interval '1 hour'
       where id = '${(await delivery()).id}'`,
    );
    await expect(asWorker((tx) => recoverStuckWhatsApp(tx))).resolves.toBe(1);
    const back = await delivery();
    expect(back).toMatchObject({ status: "failed", reason: "interrupted" });
    await admin.jobRun.findFirstOrThrow({
      where: {
        kind: "events.dispatch",
        idempotencyKey: `event:${event.id}:resend:${back.id}:1`,
      },
    });

    // The follow-up run posts once, with the same delivery id.
    await runEventDispatch(asWorker, event.id, { fetch, now: () => DAY });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get("x-guidu-delivery-id")).toBe(back.id);
    expect(posts[0]!.headers.get("x-guidu-event-id")).toBe(event.id);
    expect(posts[0]!.body).toMatchObject({
      event: "security.api_key_created",
      event_id: event.id,
      to: "+5511912344444",
    });
    expect(await delivery()).toMatchObject({ status: "sent", attempts: 2 });
    await runEventDispatch(asWorker, event.id, { fetch, now: () => DAY });
    expect(posts).toHaveLength(1);
  });
});
