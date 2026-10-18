import "server-only";

import { emitEvent, WORKER_ACTOR } from "@/core/events/emit";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import { getProposalOperation } from "./registry";

/**
 * Pending proposals past their validity (H4), by the hub's clock
 * (`events.notices-tick`, app_worker): each becomes `expired` (the only
 * transition the database allows without a person), emits
 * `proposals.expired` and its request's event follows (`expired`), so the
 * reminders of H2 stop.
 */
export async function expireProposals(
  tx: ContextTransaction,
  limit = 200,
): Promise<number> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      organization_id: string;
      workspace_id: string;
      operation: string;
      origin: string;
    }[]
  >`
    update public.execution_proposals
    set status = 'expired'
    where id in (
      select id from public.execution_proposals
      where status = 'pending' and expires_at <= now()
      order by expires_at
      limit ${limit}
    )
    returning id, organization_id, workspace_id, operation, origin
  `;
  for (const row of rows) {
    const [org] = await tx.$queryRaw<{ partner_id: string | null }[]>`
      select partner_id from public.organizations where id = ${row.organization_id}::uuid
    `;
    if (org?.partner_id) {
      await emitEvent(tx, {
        type: "proposals.expired",
        actor: WORKER_ACTOR,
        partnerId: org.partner_id,
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
        subject: { type: "execution_proposal", id: row.id },
        data: {
          proposalId: row.id,
          operation: row.operation,
          operationLabel:
            getProposalOperation(row.operation)?.label ?? row.operation,
          origin: row.origin,
        },
        idempotencyKey: `proposal:${row.id}:expired`,
      });
    }
    await tx.$executeRaw`select private.proposal_event_sync(${row.id}::uuid)`;
  }
  return rows.length;
}
