import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dispatchEvent } from "@/core/events/dispatch";
import { pendingLegalDocuments } from "@/core/legal/service";
import type {
  NotificationTransport,
  OutboundMessage,
} from "@/core/notifications/types";
import {
  decideByToken,
  readRequestByToken,
  readWorkspaceServiceMode,
  requestManagedMode,
  revertToStandard,
} from "@/core/service-modes/service";
import {
  type ContextTransaction,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";

import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * GB1c: the service modes end to end on the database. The partner asks;
 * the dispatch e-mails the owner a single-use link (only its hash is
 * kept); the owner approves on the partner's host; the partner then reads
 * the CRM; the link does not work twice; an expired link does nothing; the
 * owner goes back to `padrao` and the partner loses the CRM at once.
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
const partnerSupport = "d0000000-0000-4000-8000-000000000006";
const owner = "d0000000-0000-4000-8000-000000000007";
const ORIGIN = "https://painel.agencia-gb1c.test";

describeDatabase("GB1c: service modes", requiredVars, () => {
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
  const orgId = randomUUID();
  const wsId = randomUUID();
  const slug = `gb1c-${run}`;
  const ownerEmail = `dono-${run}@gb1c.test`;

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
  const dispatchAll = async () => {
    const rows = await admin.$queryRawUnsafe<{ id: string }[]>(
      `select id from public.events where organization_id = '${orgId}' and dispatched_at is null order by seq`,
    );
    for (const row of rows) {
      await asWorker((tx) => dispatchEvent(tx, row.id, { transport }));
    }
  };
  const ownerCtx = {
    userId: owner,
    workspaceId: wsId,
    organizationId: orgId,
    partnerId,
  };
  const supportCtx = { ...ownerCtx, userId: partnerSupport };
  const asPartner = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, partnerOwner, fn, { partnerId });
  const ask = () =>
    asPartner((tx) =>
      requestManagedMode(
        tx,
        { userId: partnerOwner, via: "partner" },
        orgId,
        ORIGIN,
      ),
    );
  const crmCount = () =>
    withContext(prisma, supportCtx, (tx) =>
      tx.crmContact.count({ where: { workspaceId: wsId } }),
    );
  const lastLink = () => {
    const text = sent.at(-1)?.text ?? "";
    return /\/service-mode\/([0-9a-f]{64})/.exec(text)?.[1] ?? "";
  };

  beforeAll(async () => {
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-gb1c-${run}', 'Agência GB1c')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerId}', '${partnerOwner}', 'dono-${run}@agencia.test', 'partner_owner'),
        ('${partnerId}', '${partnerSupport}', 'sup-${run}@agencia.test', 'partner_support')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organizations (id, name, status, partner_id, created_at)
       values ('${orgId}', 'Padaria ${run}', 'active', '${partnerId}', now() - interval '1 day')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspaces (id, organization_id, slug, name, status)
       values ('${wsId}', '${orgId}', '${slug}', 'Padaria', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.organization_members (organization_id, user_id, role, status)
       values ('${orgId}', '${owner}', 'owner', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
       values ('${wsId}', '${orgId}', '${owner}', 'owner', 'active')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.invitations (organization_id, workspace_id, email, role, token_hash,
         invited_by_user_id, status, expires_at, accepted_at, accepted_by_user_id)
       values ('${orgId}', '${wsId}', '${ownerEmail}', 'owner', 'gb1c-${run}', '${partnerOwner}',
         'accepted', now() + interval '1 day', now(), '${owner}')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
       values ('${orgId}', '${wsId}', 'Cliente fiel', '${owner}')`,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("e-mails a single-use link to the owner and approves on the partner host", async () => {
    expect(await crmCount()).toBe(0);
    const { requestId, expiresAt } = await ask();
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    await dispatchAll();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(ownerEmail);
    expect(sent[0]!.subject).toContain("Agência GB1c");
    const token = lastLink();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // Only the hash is kept; the event data never carries the link.
    const [stored] = await admin.$queryRawUnsafe<
      { token_hash: string; data: string }[]
    >(
      `select r.token_hash, e.data::text as data from public.service_mode_requests r
       join public.events e on e.subject_id = r.id::text
       where r.id = '${requestId}' and e.type = 'service_mode.change_requested'`,
    );
    expect(stored!.token_hash).not.toBe(token);
    expect(stored!.data).not.toContain(token);
    // The bell of the owner links to the settings, not to the token.
    const bell = await admin.$queryRawUnsafe<{ link_url: string }[]>(
      `select link_url from public.user_notifications
       where user_id = '${owner}' and event_type = 'service_mode.change_requested'
       order by created_at desc limit 1`,
    );
    expect(bell[0]?.link_url).toBe(
      `${ORIGIN}/app/${slug}/settings/service-mode`,
    );

    // Another partner's host does not know the link.
    const elsewhere = await withPartnerContext(prisma, randomUUID(), (tx) =>
      readRequestByToken(tx, token),
    );
    expect(elsewhere).toBeNull();
    const view = await withPartnerContext(prisma, partnerId, (tx) =>
      readRequestByToken(tx, token),
    );
    expect(view).toMatchObject({
      status: "pending",
      partnerName: "Agência GB1c",
    });

    const outcome = await withPartnerContext(prisma, partnerId, (tx) =>
      decideByToken(
        tx,
        token,
        "approve",
        { ip: "203.0.113.9", userAgent: "vitest" },
        ORIGIN,
      ),
    );
    expect(outcome).toBe("approved");
    expect(await crmCount()).toBe(1);

    // Single use.
    const again = await withPartnerContext(prisma, partnerId, (tx) =>
      decideByToken(tx, token, "deny", { ip: null, userAgent: null }, ORIGIN),
    );
    expect(again).toBe("already_decided");

    // The confirmation reaches who asked and the company (bell).
    sent.length = 0;
    await dispatchAll();
    const notices = await admin.$queryRawUnsafe<{ user_id: string }[]>(
      `select user_id from public.user_notifications
       where event_type = 'service_mode.changed' and user_id in ('${owner}', '${partnerOwner}')
         and created_at > now() - interval '1 minute'`,
    );
    expect(new Set(notices.map((n) => n.user_id))).toEqual(
      new Set([owner, partnerOwner]),
    );
    const card = await withContext(prisma, ownerCtx, (tx) =>
      readWorkspaceServiceMode(tx, ownerCtx),
    );
    expect(card).toMatchObject({
      mode: "gerenciado",
      source: "request",
      canManage: true,
    });
  });

  it("goes back to padrao by the owner and the partner loses access at once", async () => {
    await withContext(prisma, ownerCtx, (tx) =>
      revertToStandard(tx, ownerCtx, slug, ORIGIN),
    );
    expect(await crmCount()).toBe(0);
    await dispatchAll();
    const notices = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from public.user_notifications
       where event_type = 'service_mode.changed' and user_id = '${partnerOwner}'
         and data ->> 'to' = 'padrao' and data ->> 'organization' = 'Padaria ${run}'`,
    );
    expect(Number(notices[0]!.count)).toBe(1);
    // The support of the partner cannot go back for the company.
    await expect(
      withContext(prisma, supportCtx, (tx) =>
        revertToStandard(tx, supportCtx, slug, ORIGIN),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("does nothing with an expired link", async () => {
    const { requestId } = await ask();
    sent.length = 0;
    await dispatchAll();
    const token = lastLink();
    await admin.$executeRawUnsafe(
      `update public.service_mode_requests
       set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
       where id = '${requestId}'`,
    );
    const outcome = await withPartnerContext(prisma, partnerId, (tx) =>
      decideByToken(
        tx,
        token,
        "approve",
        { ip: null, userAgent: null },
        ORIGIN,
      ),
    );
    expect(outcome).toBe("expired");
    const [row] = await admin.$queryRawUnsafe<{ status: string }[]>(
      `select status from public.service_mode_requests where id = '${requestId}'`,
    );
    expect(row!.status).toBe("expired");
    expect(await crmCount()).toBe(0);
    // A new request may follow.
    await expect(ask()).resolves.toMatchObject({
      requestId: expect.any(String),
    });
  });

  it("asks the management clause only of owners managed by the contract", async () => {
    const pendingKinds = async () =>
      (
        await withIdentityContext(
          prisma,
          owner,
          (tx) => pendingLegalDocuments(tx, partnerId, owner),
          { partnerId },
        )
      ).map((d) => d.kind);
    await admin.$executeRawUnsafe(
      `update public.organization_service_modes set mode = 'gerenciado', source = 'registration'
       where organization_id = '${orgId}'`,
    );
    expect(await pendingKinds()).toContain("management");
    await admin.$executeRawUnsafe(
      `update public.organization_service_modes set source = 'request'
       where organization_id = '${orgId}'`,
    );
    expect(await pendingKinds()).not.toContain("management");
  });
});
