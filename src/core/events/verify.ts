import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { appConfig } from "@/core/config/app";
import { definePlatformJob, type JobSchedule } from "@/core/jobs/definition";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { emitEvent, WORKER_ACTOR } from "./emit";
import { checkSeal, type SealCheck, type SealMaterial, sealKeys } from "./seal";

/**
 * Verification of the seals (H1, ADR 0022 §5):
 * - `verifyEventRow`: recomputes an event's seal and compares;
 * - `verifyPresentedData`: the data a customer presents, with the
 *   situation the platform sees (type, ids, moment, author, previous seal),
 *   gives the same seal? The platform checks a claim without opening the
 *   event's data;
 * - the daily job `events.verify-chains` walks every chain in order and
 *   records, per event, `ok`, `broken` (seal or link do not match) or
 *   `unverifiable` (a key version it does not hold). A newly broken event
 *   goes to the platform's audit and raises `platform.events.chain_broken`.
 */

export const EVENTS_VERIFY_JOB_KIND = "events.verify-chains";
const BATCH = 500;
const VERIFY_HOUR_UTC = 4;

export type EventSealRow = Readonly<{
  id: string;
  type: string;
  partner_id: string | null;
  organization_id: string | null;
  workspace_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  created_by: string | null;
  occurred_at: Date;
  data: unknown;
  prev_hash: string | null;
  content_hash: string;
  key_version: string;
}>;

export function materialOf(row: EventSealRow): SealMaterial {
  return {
    id: row.id,
    type: row.type,
    partnerId: row.partner_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    createdBy: row.created_by,
    occurredAt: row.occurred_at,
    data: row.data,
    prevHash: row.prev_hash,
  };
}

export function verifyEventRow(
  row: EventSealRow,
  keys: ReadonlyMap<string, string> = sealKeys(),
): SealCheck {
  return checkSeal(materialOf(row), row.content_hash, row.key_version, keys);
}

/** The situation of an event (without data) plus the data presented. */
export function verifyPresentedData(
  situation: Omit<EventSealRow, "data">,
  presented: unknown,
  keys: ReadonlyMap<string, string> = sealKeys(),
): SealCheck {
  return verifyEventRow({ ...situation, data: presented }, keys);
}

export type ChainLink = Readonly<{
  seq: number;
  prev_hash: string | null;
}>;

/** The link to the event before it in the chain is intact. */
export function linkOk(
  row: ChainLink,
  previous: Readonly<{ seq: number; content_hash: string }> | null,
): boolean {
  if (row.seq === 1) return row.prev_hash === null && previous === null;
  return (
    previous !== null &&
    previous.seq === row.seq - 1 &&
    row.prev_hash === previous.content_hash
  );
}

export type VerifyResult = Readonly<{
  chains: number;
  events: number;
  broken: number;
  unverifiable: number;
  newlyBroken: number;
}>;

type Row = EventSealRow &
  Readonly<{ seq: bigint | number; integrity: string | null }>;

export async function verifyEventChains(
  tx: ContextTransaction,
  keys: ReadonlyMap<string, string> = sealKeys(),
): Promise<VerifyResult> {
  const chains = await tx.$queryRaw<{ chain_key: string }[]>`
    select distinct chain_key from public.events order by chain_key
  `;
  let events = 0;
  let broken = 0;
  let unverifiable = 0;
  const newly: {
    id: string;
    type: string;
    chainKey: string;
    reason: string;
  }[] = [];
  for (const { chain_key: chainKey } of chains) {
    let previous: { seq: number; content_hash: string } | null = null;
    let after = 0;
    const byResult: Record<"ok" | "broken" | "unverifiable", string[]> = {
      ok: [],
      broken: [],
      unverifiable: [],
    };
    for (;;) {
      const rows = await tx.$queryRaw<Row[]>`
        select id, type, partner_id, organization_id, workspace_id, subject_type,
               subject_id, created_by, occurred_at, data, prev_hash, content_hash,
               key_version, seq, integrity
        from public.events
        where chain_key = ${chainKey} and seq > ${after}
        order by seq
        limit ${BATCH}
      `;
      for (const row of rows) {
        const seq = Number(row.seq);
        const seal = verifyEventRow(row, keys);
        const link = linkOk({ seq, prev_hash: row.prev_hash }, previous);
        const result =
          seal === "unknown_key"
            ? "unverifiable"
            : seal === "ok" && link
              ? "ok"
              : "broken";
        byResult[result].push(row.id);
        if (result === "broken" && row.integrity !== "broken") {
          newly.push({
            id: row.id,
            type: row.type,
            chainKey,
            reason: seal === "ok" ? "link" : "seal",
          });
        }
        previous = { seq, content_hash: row.content_hash };
        after = seq;
      }
      events += rows.length;
      if (rows.length < BATCH) break;
    }
    broken += byResult.broken.length;
    unverifiable += byResult.unverifiable.length;
    for (const [integrity, ids] of Object.entries(byResult)) {
      if (ids.length === 0) continue;
      await tx.$executeRaw`
        update public.events set integrity = ${integrity}, verified_at = now()
        where id = any(${ids}::uuid[])
      `;
    }
  }

  for (const item of newly) {
    await recordAudit(
      tx,
      {
        userId: "",
        workspaceId: "",
        organizationId: "",
        principalType: "service",
      },
      {
        action: "platform.events.chain_broken",
        resourceType: "event",
        resourceId: item.id,
        result: "error",
        origin: "worker",
        metadata: {
          eventId: item.id,
          eventType: item.type,
          chainKey: item.chainKey,
          reason: item.reason,
        },
      },
    );
  }
  if (newly.length > 0) {
    const ids = newly.map((item) => item.id).sort();
    await emitEvent(tx, {
      type: "platform.events.chain_broken",
      actor: WORKER_ACTOR,
      data: {
        count: newly.length,
        chains: [...new Set(newly.map((item) => item.chainKey))].slice(0, 20),
        eventIds: ids.slice(0, 20),
        linkUrl: new URL("/platform/events", appConfig.url).toString(),
      },
      idempotencyKey: `chain-broken:${createHash("sha256")
        .update(ids.join(","))
        .digest("hex")}`,
    });
  }
  return {
    chains: chains.length,
    events,
    broken,
    unverifiable,
    newlyBroken: newly.length,
  };
}

export const verifyChainsJob = definePlatformJob({
  kind: EVENTS_VERIFY_JOB_KIND,
  description:
    "Confere o selo e a corrente de todos os eventos da Central de Eventos.",
  payload: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  maxAttempts: 2,
  retryDelaySeconds: 300,
  async run(tx) {
    return verifyEventChains(tx);
  },
});

/** Daily, from 04:00 UTC (01:00 in Brasília). */
export const verifyChainsSchedule: JobSchedule = {
  kind: EVENTS_VERIFY_JOB_KIND,
  description: "Diária, a partir das 01:00 (Brasília).",
  due(now) {
    if (now.getUTCHours() < VERIFY_HOUR_UTC) return null;
    const date = now.toISOString().slice(0, 10);
    return { key: date, payload: { date } };
  },
};
