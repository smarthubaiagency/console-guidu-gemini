import { randomInt, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listPlatformEvents } from "@/core/events/platform";
import { listPartnerEvents } from "@/core/events/views";
import {
  IP_BLOCKED_JOB_KIND,
  ipBlockedHour,
  ipBlockedKey,
  recordIpBlocked,
} from "@/core/security/ip-blocked";
import {
  emitIpBlocked,
  type IpBlockedPayload,
} from "@/core/security/ip-blocked-job";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * AJ1: `security.ip_blocked`. The gate queues at most one job per address,
 * area and hour, only for an address the list really refuses; the worker
 * records the event at the platform (/platform) or the partner (/admin)
 * level, with the address and the area only.
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
const PARTNER_OWNER = "d0000000-0000-4000-8000-000000000004";

describeDatabase("AJ1: security.ip_blocked", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });
  const partnerId = randomUUID();
  // A fresh address per run: the keys are per hour.
  const blocked = `198.51.100.${randomInt(1, 254)}`;
  const blockedV6 = `2001:db8:a1::${randomInt(1, 65535).toString(16)}`;
  const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
    workerDb.$transaction((tx) => fn(tx as unknown as ContextTransaction));
  const jobs = (key: string) =>
    admin.$queryRawUnsafe<{ payload: IpBlockedPayload }[]>(
      `select payload from public.job_runs where kind = $1 and idempotency_key = $2`,
      IP_BLOCKED_JOB_KIND,
      key,
    );

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.ip_allowlists where area = 'platform' or partner_id = '${partnerId}'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${partnerId}', 'aj1-${partnerId.slice(0, 8)}', 'Agência AJ1')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${partnerId}', '${PARTNER_OWNER}', 'owner@aj1.test', 'partner_owner')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.ip_allowlists (area, partner_id, entries, updated_by) values
        ('platform', null, array['203.0.113.0/24']::cidr[], '${PLATFORM_OWNER}'),
        ('admin', '${partnerId}', array['203.0.113.0/24']::cidr[], '${PARTNER_OWNER}')`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("queues one job per address, area and hour, only for a refused address", async () => {
    const hour = ipBlockedHour(new Date());
    expect(await recordIpBlocked(prisma, "platform", null, blocked)).toBe(true);
    // Same address, area and hour: nothing new (no flood).
    expect(await recordIpBlocked(prisma, "platform", null, blocked)).toBe(
      false,
    );
    const key = ipBlockedKey("platform", null, blocked, hour);
    expect(await jobs(key)).toEqual([
      { payload: { area: "platform", partnerId: null, ip: blocked, hour } },
    ]);
    // The partner's /admin is another area: one more.
    expect(await recordIpBlocked(prisma, "admin", partnerId, blocked)).toBe(
      true,
    );
    // An address inside the list is refused by the database.
    expect(await recordIpBlocked(prisma, "platform", null, "203.0.113.9")).toBe(
      false,
    );
    expect(
      await jobs(ipBlockedKey("platform", null, "203.0.113.9", hour)),
    ).toEqual([]);
    // An IPv6 address keeps its host form in the key.
    expect(await recordIpBlocked(prisma, "admin", partnerId, blockedV6)).toBe(
      true,
    );
    expect(
      await jobs(ipBlockedKey("admin", partnerId, blockedV6, hour)),
    ).toHaveLength(1);
  });

  it("refuses a forged job (wrong hour, key or an allowed address)", async () => {
    const insert = (payload: object, key: string) =>
      prisma.$executeRawUnsafe(
        `insert into public.job_runs (kind, scope, payload, idempotency_key)
         values ($1, 'platform', $2::jsonb, $3)`,
        IP_BLOCKED_JOB_KIND,
        JSON.stringify(payload),
        key,
      );
    const hour = ipBlockedHour(new Date());
    const other = `198.51.100.${randomInt(1, 254)}`;
    await expect(
      insert(
        { area: "platform", partnerId: null, ip: other, hour: "2020-01-01T00" },
        ipBlockedKey("platform", null, other, "2020-01-01T00"),
      ),
    ).rejects.toThrow();
    await expect(
      insert(
        { area: "platform", partnerId: null, ip: other, hour },
        `ip_blocked:platform:${other}:x`,
      ),
    ).rejects.toThrow();
    await expect(
      insert(
        { area: "platform", partnerId: null, ip: "203.0.113.1", hour },
        ipBlockedKey("platform", null, "203.0.113.1", hour),
      ),
    ).rejects.toThrow();
  });

  it("records the event at the right level, once, with the address and the area only", async () => {
    const hour = ipBlockedHour(new Date());
    const [platformJob] = await jobs(
      ipBlockedKey("platform", null, blocked, hour),
    );
    const [adminJob] = await jobs(
      ipBlockedKey("admin", partnerId, blocked, hour),
    );
    const platformId = await asWorker((tx) =>
      emitIpBlocked(tx, platformJob!.payload),
    );
    // A retry finds the same event.
    expect(
      await asWorker((tx) => emitIpBlocked(tx, platformJob!.payload)),
    ).toBe(platformId);
    const adminId = await asWorker((tx) =>
      emitIpBlocked(tx, adminJob!.payload),
    );
    const rows = await admin.$queryRawUnsafe<
      {
        id: string;
        level: string;
        route: string;
        partner_id: string | null;
        data: Record<string, unknown>;
      }[]
    >(
      `select id::text, level, route, partner_id::text, data from public.events
       where id in ($1::uuid, $2::uuid) order by level`,
      platformId,
      adminId,
    );
    expect(rows).toEqual([
      {
        id: adminId,
        level: "partner",
        route: "partner",
        partner_id: partnerId,
        data: { ip: blocked, area: "admin" },
      },
      {
        id: platformId,
        level: "platform",
        route: "platform",
        partner_id: null,
        data: { ip: blocked, area: "platform" },
      },
    ]);

    // The partner sees its /admin event (with the data), not the platform's.
    const partnerRows = await withIdentityContext(
      prisma,
      PARTNER_OWNER,
      (tx) => listPartnerEvents(tx, partnerId, { module: "security" }),
      { partnerId },
    );
    expect(partnerRows.map((r) => r.id)).toContain(adminId);
    expect(partnerRows.map((r) => r.id)).not.toContain(platformId);
    expect(partnerRows.find((r) => r.id === adminId)?.data).toEqual({
      ip: blocked,
      area: "admin",
    });
    // The platform sees its own.
    const platformRows = await withIdentityContext(
      prisma,
      PLATFORM_OWNER,
      (tx) =>
        listPlatformEvents(
          tx,
          { userId: PLATFORM_OWNER, platformRole: "owner" },
          { type: "security.ip_blocked" },
          100,
        ),
    );
    expect(platformRows.map((r) => r.id)).toContain(platformId);
  });
});
