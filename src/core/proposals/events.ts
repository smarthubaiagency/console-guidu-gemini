import "server-only";

import type { AuditOrigin } from "@/core/audit/record";
import { appConfig } from "@/core/config/app";
import type { EventType } from "@/core/events/catalog";
import { contextPartnerId, emitEvent } from "@/core/events/emit";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import { getProposalOperation } from "./registry";

/**
 * Each step of a proposal is an event of the hub (H4): requested (waits
 * for a decision, `pending`), approved (hands the execution to the
 * subscriber `proposals.execute`), rejected, executed, failed and expired
 * (`expiry.ts`, by the worker). The request's event follows the proposal
 * (`private.proposal_event_sync`), so the escalation of H2 applies while
 * nobody decides. The data carries what the notice needs, never the
 * payload: the operation, the workspace and the link to decide (the
 * workspace's page in `padrao`, the /admin queue in `gerenciado`).
 */

export type ProposalStep =
  "requested" | "approved" | "rejected" | "executed" | "failed";

export type ProposalEventRow = Readonly<{
  id: string;
  workspaceId: string;
  organizationId: string;
  operation: string;
  origin: string;
  reason: string | null;
  expiresAt: Date;
}>;

/** The link a person opens to see (and, who may, decide) a proposal. */
export function proposalLink(
  args: Readonly<{
    proposalId: string;
    workspaceSlug: string;
    managed: boolean;
  }>,
): string {
  return new URL(
    args.managed
      ? `/admin/proposals?proposal=${args.proposalId}`
      : `/app/${args.workspaceSlug}/proposals/${args.proposalId}`,
    appConfig.url,
  ).toString();
}

export async function emitProposalEvent(
  tx: ContextTransaction,
  ctx: RequestContext,
  row: ProposalEventRow,
  step: ProposalStep,
  options: Readonly<{
    origin: AuditOrigin;
    causedBy?: string | null;
    error?: string | null;
  }>,
): Promise<string> {
  const [workspace, mode] = await Promise.all([
    tx.workspace.findFirst({
      where: { id: row.workspaceId },
      select: { slug: true, name: true },
    }),
    tx.organizationServiceMode.findUnique({
      where: { organizationId: row.organizationId },
      select: { mode: true },
    }),
  ]);
  const operation = getProposalOperation(row.operation);
  const emitted = await emitEvent(tx, {
    type: `proposals.${step}` as EventType,
    actor: {
      userId: ctx.userId,
      principalType: ctx.principalType ?? "user",
      origin: options.origin,
    },
    partnerId: await contextPartnerId(tx),
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    subject: { type: "execution_proposal", id: row.id },
    data: {
      proposalId: row.id,
      operation: row.operation,
      operationLabel: operation?.label ?? row.operation,
      origin: row.origin,
      workspaceName: workspace?.name ?? "",
      ...(step === "requested"
        ? { reason: row.reason ?? "", expiresAt: row.expiresAt.toISOString() }
        : {}),
      ...(options.error ? { error: options.error } : {}),
      linkUrl: proposalLink({
        proposalId: row.id,
        workspaceSlug: workspace?.slug ?? "",
        managed: mode?.mode === "gerenciado",
      }),
    },
    idempotencyKey: `proposal:${row.id}:${step}`,
    status: step === "requested" ? "pending" : "open",
    causedBy: options.causedBy ?? null,
  });
  return emitted.id;
}

/** The request's event follows the proposal's status. */
export async function syncProposalEvent(
  tx: ContextTransaction,
  proposalId: string,
): Promise<void> {
  await tx.$executeRaw`select private.proposal_event_sync(${proposalId}::uuid)`;
}
