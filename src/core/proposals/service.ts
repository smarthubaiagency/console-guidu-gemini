import { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { defineJob } from "@/core/jobs/definition";
import { QuotaExceededError } from "@/core/entitlements/quotas";
import { enqueueJob } from "@/core/jobs/service";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  requireWorkspacePermission,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import { type Assurance, requireMfa } from "@/core/privacy/export";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError, toSafeError } from "@/shared/errors";

import { proposalHash, type ProposalOperation } from "./operation";
import { getProposalOperation } from "./registry";

/**
 * Proposals with human approval (F4d, Especificação §17.4, AC11).
 *
 * - An assistant creates a proposal with its API key (`propose_operation`,
 *   scope `proposals:write`). Nothing runs: the content is validated by the
 *   operation, normalized, hashed with the workspace, the target and its
 *   version, and stored for 24 hours.
 * - Owner or admin approves it on the proposals screen, with the browser
 *   session and MFA verified, bound to the exact hash shown. A key never
 *   approves (the model's approval is not a person's).
 * - The approval queues a job that runs in the approver's context and
 *   checks everything again: status, expiry, integrity of the content,
 *   version of the target, module state, permission and quota. The status
 *   moves to `executed` in the same transaction as the effect, so running
 *   the job again does nothing.
 */

export const PROPOSAL_TTL_MS = 24 * 60 * 60_000;
/** Pending proposals per workspace; more wait for decisions. */
export const MAX_PENDING_PROPOSALS = 50;

export type ProposalStatus =
  "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

export type ProposalView = Readonly<{
  id: string;
  operation: string;
  operationLabel: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  resourceVersion: string | null;
  reason: string | null;
  status: ProposalStatus;
  expiresAt: Date;
  createdAt: Date;
  requestedBy: string;
  requestedByMe: boolean;
  decidedBy: string | null;
  decidedAt: Date | null;
  executedAt: Date | null;
  resourceId: string | null;
  errorCode: string | null;
}>;

type ProposalRow = Prisma.ExecutionProposalGetPayload<object>;

export const ProposeInput = z
  .object({
    operation: z.string().min(1).max(96),
    targetId: z.string().uuid().optional(),
    payload: z.record(z.string(), z.unknown()),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[\w.:-]+$/, "Use letras, números, ponto, dois-pontos ou hífen."),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

function invalid(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
}

function conflict(message: string): AppError {
  return new AppError({ code: "conflict", safeMessage: message });
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Proposta não encontrada.",
  });
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toView(row: ProposalRow, ctx: RequestContext): ProposalView {
  const open = row.status === "pending" || row.status === "approved";
  const result = asObject(row.result);
  return {
    id: row.id,
    operation: row.operation,
    operationLabel: getProposalOperation(row.operation)?.label ?? row.operation,
    targetId: row.targetId,
    payload: asObject(row.payload),
    payloadHash: row.payloadHash,
    resourceVersion: row.resourceVersion,
    reason: row.reason,
    status:
      open && row.expiresAt.getTime() <= Date.now()
        ? "expired"
        : (row.status as ProposalStatus),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    requestedBy: row.requestedBy,
    requestedByMe: row.requestedBy === ctx.userId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    executedAt: row.executedAt,
    resourceId:
      typeof result.resourceId === "string" ? result.resourceId : null,
    errorCode: row.errorCode,
  };
}

function hashOf(row: ProposalRow): string {
  return proposalHash({
    workspaceId: row.workspaceId,
    operation: row.operation,
    targetId: row.targetId,
    resourceVersion: row.resourceVersion,
    payload: row.payload,
  });
}

/** Locks the proposal row of the context workspace for this transaction. */
async function lockProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposalId: string,
): Promise<ProposalRow | null> {
  if (!z.string().uuid().safeParse(proposalId).success) return null;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    select id from public.execution_proposals
    where id = ${proposalId}::uuid and workspace_id = ${ctx.workspaceId}::uuid
    for update
  `;
  if (!locked[0]) return null;
  return tx.executionProposal.findFirst({
    where: { id: proposalId, workspaceId: ctx.workspaceId },
  });
}

function requirePerson(ctx: RequestContext): void {
  if (ctx.principalType === "api_key" || ctx.principalType === "service") {
    throw new AppError({
      code: "forbidden",
      safeMessage: "Só uma pessoa decide uma proposta, pela tela do workspace.",
    });
  }
}

/** Creates a proposal for an assistant's key; never runs the effect. */
export async function createProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<{ proposal: ProposalView; created: boolean }> {
  if (ctx.principalType !== "api_key" || !ctx.grantId) {
    throw new AppError({
      code: "forbidden",
      safeMessage: "Propostas são criadas por assistentes, com chave de API.",
    });
  }
  const parsed = ProposeInput.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues[0]?.message ?? "Proposta inválida.");
  }
  const { operation, targetId, idempotencyKey, reason } = parsed.data;
  const op = getProposalOperation(operation);
  if (!op) throw invalid(`Operação desconhecida: ${operation}.`);
  if (op.needsTarget !== Boolean(targetId)) {
    throw invalid(
      op.needsTarget
        ? "Esta operação precisa de targetId."
        : "Esta operação não recebe targetId.",
    );
  }
  await assertModuleOperational(tx, ctx, op.moduleKey, "write");
  await requireWorkspacePermission(tx, ctx, op.permission);
  const payload = op.parse(parsed.data.payload);
  const resourceVersion = targetId ? await op.version(tx, ctx, targetId) : null;
  const payloadHash = proposalHash({
    workspaceId: ctx.workspaceId,
    operation,
    targetId: targetId ?? null,
    resourceVersion,
    payload,
  });

  // Same key, same content: the same proposal. Same key, other content:
  // conflict. Serialized per key so two retries cannot both insert.
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`proposal:${ctx.workspaceId}:${idempotencyKey}`}))`;
  const existing = await tx.executionProposal.findFirst({
    where: { workspaceId: ctx.workspaceId, idempotencyKey },
  });
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw conflict(
        "Esta chave de idempotência já foi usada com outro conteúdo.",
      );
    }
    return { proposal: toView(existing, ctx), created: false };
  }
  const pending = await tx.executionProposal.count({
    where: {
      workspaceId: ctx.workspaceId,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  });
  if (pending >= MAX_PENDING_PROPOSALS) {
    throw new AppError({
      code: "rate_limited",
      safeMessage:
        "Há propostas demais esperando decisão neste workspace. Aguarde as aprovações.",
    });
  }

  const row = await tx.executionProposal.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      requestedBy: ctx.userId,
      apiKeyId: ctx.grantId,
      operation,
      targetId: targetId ?? null,
      payload: payload as Prisma.InputJsonObject,
      payloadHash,
      resourceVersion,
      reason: reason ?? null,
      idempotencyKey,
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
    },
  });
  await recordAudit(tx, ctx, {
    action: "proposal.create",
    resourceType: "execution_proposal",
    resourceId: row.id,
    result: "success",
    origin: "mcp",
    metadata: { action: operation, target: targetId ?? null },
  });
  return { proposal: toView(row, ctx), created: true };
}

export async function listProposals(
  tx: ContextTransaction,
  ctx: RequestContext,
  options: Readonly<{ view?: "open" | "all"; take?: number }> = {},
): Promise<ProposalView[]> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_PROPOSALS_REVIEW,
  );
  const rows = await tx.executionProposal.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(options.view === "open"
        ? { status: "pending", expiresAt: { gt: new Date() } }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.take ?? 50,
  });
  return rows.map((row) => toView(row, ctx));
}

/** Owner and admin see any proposal; the member who asked sees their own. */
export async function getProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposalId: string,
): Promise<ProposalView> {
  if (!z.string().uuid().safeParse(proposalId).success) throw notFound();
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  if (!role) throw notFound();
  const reviewer = workspaceRoleGrants(
    role,
    Permissions.WORKSPACE_PROPOSALS_REVIEW,
  );
  const row = await tx.executionProposal.findFirst({
    where: {
      id: proposalId,
      workspaceId: ctx.workspaceId,
      ...(reviewer ? {} : { requestedBy: ctx.userId }),
    },
  });
  if (!row) throw notFound();
  return toView(row, ctx);
}

/** Current values of the target, for the approval screen (null for creations). */
export async function loadProposalTarget(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposal: ProposalView,
): Promise<
  Readonly<{
    operation: ProposalOperation | null;
    current: Record<string, unknown> | null;
    currentVersion: string | null;
  }>
> {
  const operation = getProposalOperation(proposal.operation);
  if (!operation || !proposal.targetId) {
    return { operation, current: null, currentVersion: null };
  }
  try {
    return {
      operation,
      current: await operation.current(tx, ctx, proposal.targetId),
      currentVersion: await operation.version(tx, ctx, proposal.targetId),
    };
  } catch {
    return { operation, current: null, currentVersion: null };
  }
}

export const proposalExecuteJob = defineJob<{ proposalId: string }>({
  kind: "core.proposal-execute",
  description:
    "Executa uma proposta aprovada, reconferindo validade, conteúdo, versão e permissões.",
  payload: z.object({ proposalId: z.string().uuid() }),
  maxAttempts: 3,
  async run(tx, ctx, payload) {
    return executeProposal(tx, ctx, payload.proposalId);
  },
});

/** Approval by a person, with MFA, bound to the hash they saw. */
export async function approveProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposalId: string,
  input: Readonly<{ payloadHash: string }>,
  assurance: Assurance,
): Promise<ProposalView> {
  requirePerson(ctx);
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_PROPOSALS_REVIEW,
  );
  requireMfa(assurance);
  const row = await lockProposal(tx, ctx, proposalId);
  if (!row) throw notFound();
  if (row.status !== "pending")
    throw conflict("Esta proposta já foi decidida.");
  if (row.expiresAt.getTime() <= Date.now()) {
    throw conflict("A proposta venceu. Peça ao assistente uma nova.");
  }
  if (input.payloadHash !== row.payloadHash) {
    throw conflict(
      "O conteúdo não é o que estava na tela. Abra a proposta de novo.",
    );
  }
  if (hashOf(row) !== row.payloadHash) {
    throw conflict("O conteúdo da proposta não confere com o registrado.");
  }
  const op = getProposalOperation(row.operation);
  if (!op) throw invalid("Operação desconhecida nesta versão.");
  await assertModuleOperational(tx, ctx, op.moduleKey, "write");
  await requireWorkspacePermission(tx, ctx, op.permission);
  if (row.targetId) {
    const current = await op.version(tx, ctx, row.targetId);
    if (current !== row.resourceVersion) {
      throw conflict(
        "O registro mudou depois da proposta. Peça ao assistente uma nova.",
      );
    }
  }

  const updated = await tx.executionProposal.update({
    where: { id: row.id },
    data: {
      status: "approved",
      decidedBy: ctx.userId,
      decidedAt: new Date(),
      approvedHash: row.payloadHash,
    },
  });
  await enqueueJob(
    tx,
    ctx,
    proposalExecuteJob,
    { proposalId: row.id },
    { idempotencyKey: `proposal:${row.id}` },
  );
  await recordAudit(tx, ctx, {
    action: "proposal.approve",
    resourceType: "execution_proposal",
    resourceId: row.id,
    result: "success",
    metadata: { action: row.operation, target: row.targetId },
  });
  return toView(updated, ctx);
}

export async function rejectProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposalId: string,
): Promise<ProposalView> {
  requirePerson(ctx);
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_PROPOSALS_REVIEW,
  );
  const row = await lockProposal(tx, ctx, proposalId);
  if (!row) throw notFound();
  if (row.status !== "pending")
    throw conflict("Esta proposta já foi decidida.");
  const updated = await tx.executionProposal.update({
    where: { id: row.id },
    data: { status: "rejected", decidedBy: ctx.userId, decidedAt: new Date() },
  });
  await recordAudit(tx, ctx, {
    action: "proposal.reject",
    resourceType: "execution_proposal",
    resourceId: row.id,
    result: "success",
    metadata: { action: row.operation, target: row.targetId },
  });
  return toView(updated, ctx);
}

type ExecuteSummary = Readonly<{
  proposalId: string;
  status: string;
  error: string | null;
}>;

/**
 * Runs an approved proposal (the job, in the approver's context). Only an
 * `approved` row runs; any other status returns without effect, so a
 * second run never repeats the effect.
 */
export async function executeProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposalId: string,
): Promise<ExecuteSummary> {
  // Without the permission the row cannot be updated either: the job fails
  // and the proposal stays approved until it expires.
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_PROPOSALS_REVIEW,
  );
  const row = await lockProposal(tx, ctx, proposalId);
  if (!row) return { proposalId, status: "missing", error: null };
  if (row.status !== "approved") {
    return { proposalId, status: row.status, error: null };
  }

  const finish = async (
    status: "executed" | "failed",
    error: string | null,
    resourceId: string | null,
  ): Promise<ExecuteSummary> => {
    await tx.executionProposal.update({
      where: { id: row.id },
      data: {
        status,
        executedAt: new Date(),
        errorCode: error,
        result: resourceId ? { resourceId } : Prisma.DbNull,
      },
    });
    await recordAudit(tx, ctx, {
      action: "proposal.execute",
      resourceType: "execution_proposal",
      resourceId: row.id,
      result: status === "executed" ? "success" : "error",
      origin: "worker",
      metadata: {
        action: row.operation,
        target: resourceId ?? row.targetId,
        status,
        ...(error ? { reason: error } : {}),
      },
    });
    return { proposalId: row.id, status, error };
  };

  if (row.expiresAt.getTime() <= Date.now()) {
    return finish("failed", "expired", null);
  }
  if (row.approvedHash !== row.payloadHash || hashOf(row) !== row.payloadHash) {
    return finish("failed", "tampered", null);
  }
  const op = getProposalOperation(row.operation);
  if (!op) return finish("failed", "unknown_operation", null);

  if (row.targetId) {
    let current: string | null = null;
    try {
      current = await op.version(tx, ctx, row.targetId);
    } catch (error) {
      const safe = toSafeError(error);
      if (safe.code === "internal") throw error;
      return finish("failed", safe.code, null);
    }
    if (current !== row.resourceVersion) return finish("failed", "stale", null);
  }

  // The effect runs behind a savepoint: a refusal (module, permission,
  // quota, data) is recorded as the outcome instead of aborting.
  await tx.$executeRawUnsafe("savepoint proposal_effect");
  try {
    const done = await op.execute(tx, ctx, asObject(row.payload), row.targetId);
    await tx.$executeRawUnsafe("release savepoint proposal_effect");
    return finish("executed", null, done.resourceId);
  } catch (error) {
    await tx.$executeRawUnsafe("rollback to savepoint proposal_effect");
    if (error instanceof QuotaExceededError) {
      return finish("failed", "quota_exceeded", null);
    }
    const safe = toSafeError(error);
    if (safe.code === "internal") throw error;
    return finish("failed", safe.code, null);
  }
}
