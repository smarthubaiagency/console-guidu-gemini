import { Prisma } from "@prisma/client";
import { z } from "zod";

import { type AuditOrigin, recordAudit } from "@/core/audit/record";
import { defineJob } from "@/core/jobs/definition";
import { QuotaExceededError } from "@/core/entitlements/quotas";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { readServiceMode } from "@/core/organizations/service-mode";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  PermissionDeniedError,
  requireWorkspacePermission,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  isPartnerRole,
} from "@/core/permissions/matrix";
import { type Assurance, requireMfa } from "@/core/privacy/export";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError, toSafeError } from "@/shared/errors";

import { emitProposalEvent, syncProposalEvent } from "./events";
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
 *
 * H4 (Central de Eventos):
 * - a third origin, the module's agent (`createAgentProposal`): a job
 *   that runs for a person of the workspace (or for the managing
 *   partner), with neither API key nor Assistant turn, tied to the event
 *   that led to it (`source_event_id`) and valid up to 7 days (per
 *   operation, `agentTtlHours`);
 * - who decides follows the service mode (`requireApprover`): owner and
 *   admin in `padrao`; the managing partner's owner, admin and support in
 *   `gerenciado` (permission `partner.proposals.review`, from /admin),
 *   where the customer only follows;
 * - each step is an event (`events.ts`); the approval no longer queues the
 *   job itself: `proposals.approved` hands the execution to the
 *   subscriber `proposals.execute` (`subscriber.ts`), which runs it in the
 *   approver's context. `core.proposal-execute` stays for the runs
 *   already queued.
 */

export const PROPOSAL_TTL_MS = 24 * 60 * 60_000;
/** The longest validity of an agent's proposal (H4). */
export const AGENT_PROPOSAL_MAX_TTL_HOURS = 7 * 24;
/** Pending proposals per workspace; more wait for decisions. */
export const MAX_PENDING_PROPOSALS = 50;

export type ProposalStatus =
  "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

export type ProposalOrigin = "api_key" | "assistant" | "agent";

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
  origin: ProposalOrigin;
  sourceEventId: string | null;
  workspaceId: string;
  organizationId: string;
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

const IDEMPOTENCY_KEY_FORMAT =
  "Use letras, números, ponto, dois-pontos ou hífen.";

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
      .regex(/^[\w.:-]+$/, IDEMPOTENCY_KEY_FORMAT),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

function invalid(
  message: string,
  key?: string,
  messageValues?: Record<string, string | number>,
): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    ...(key ? { messageKey: `proposals.errors.${key}` } : {}),
    ...(messageValues ? { messageValues } : {}),
  });
}

function conflict(message: string, key: string): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: message,
    messageKey: `proposals.errors.${key}`,
  });
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Proposta não encontrada.",
    messageKey: "proposals.errors.notFound",
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
    origin: row.origin as ProposalOrigin,
    sourceEventId: row.sourceEventId,
    workspaceId: row.workspaceId,
    organizationId: row.organizationId,
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
      messageKey: "proposals.errors.humanDecides",
    });
  }
}

export type ApproverKind = "member" | "partner";

function managedFollows(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage:
      "Esta empresa é gerenciada: quem decide as propostas é a equipe de quem gerencia.",
    messageKey: "proposals.errors.managedFollows",
  });
}

/**
 * Who decides in this context, by the service mode (H4): owner and admin
 * of a standard company; the managing partner's owner, admin and support
 * of a managed one. Null: nobody here (the managed customer follows).
 */
export async function approverKind(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<ApproverKind | null> {
  const [mode, role] = await Promise.all([
    readServiceMode(tx, ctx.organizationId),
    getEffectiveWorkspaceRole(tx, ctx),
  ]);
  if (role) {
    return mode === "padrao" &&
      workspaceRoleGrants(role, Permissions.WORKSPACE_PROPOSALS_REVIEW)
      ? "member"
      : null;
  }
  if (mode !== "gerenciado" || !ctx.partnerId) return null;
  const [row] = await tx.$queryRaw<{ manages: boolean; role: string | null }[]>`
    select private.partner_manages_organization(${ctx.organizationId}::uuid) as manages,
           private.current_partner_role() as role
  `;
  return row?.manages &&
    row.role &&
    isPartnerRole(row.role) &&
    hasPartnerRolePermission(row.role, Permissions.PARTNER_PROPOSALS_REVIEW)
    ? "partner"
    : null;
}

/** The approver of this context, or the refusal that explains why not. */
export async function requireApprover(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<ApproverKind> {
  const kind = await approverKind(tx, ctx);
  if (kind) return kind;
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  if (
    role &&
    workspaceRoleGrants(role, Permissions.WORKSPACE_PROPOSALS_REVIEW) &&
    (await readServiceMode(tx, ctx.organizationId)) === "gerenciado"
  ) {
    throw managedFollows();
  }
  throw new PermissionDeniedError();
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
      messageKey: "proposals.errors.createdByAssistants",
    });
  }
  return insertProposal(tx, ctx, input, {
    apiKeyId: ctx.grantId,
    aiExecutionId: null,
    origin: "mcp",
    proposalOrigin: "api_key",
    sourceEventId: null,
  });
}

/**
 * Creates a proposal for the GUIDU Assistant (A2b, propose_operation), in
 * the name of the person who talks to it: same checks, same hash, no API
 * key. The person reviews it on the proposals page; nothing runs now.
 */
export async function createAssistantProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  executionId: string,
  input: unknown,
): Promise<{ proposal: ProposalView; created: boolean }> {
  if ((ctx.principalType ?? "user") !== "user") {
    throw new AppError({
      code: "forbidden",
      safeMessage: "Só o Assistente, em nome de uma pessoa, usa esta entrada.",
      messageKey: "proposals.errors.createdByAssistants",
    });
  }
  return insertProposal(tx, ctx, input, {
    apiKeyId: null,
    aiExecutionId: executionId,
    origin: "app",
    proposalOrigin: "assistant",
    sourceEventId: null,
  });
}

/**
 * Creates a proposal for a module's agent (H4): a job that runs for a
 * person of the workspace, or for the managing partner (ADR 0020), with
 * neither API key nor Assistant turn. `sourceEventId` is the event of the
 * workspace that led to it (a hand-off); the proposal waits up to the
 * operation's `agentTtlHours` (7 days at most). Same checks and hash.
 */
export async function createAgentProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  sourceEventId: string,
  input: unknown,
): Promise<{ proposal: ProposalView; created: boolean }> {
  if ((ctx.principalType ?? "user") !== "user") {
    throw new AppError({
      code: "forbidden",
      safeMessage:
        "Só o agente de um módulo, por uma pessoa, usa esta entrada.",
      messageKey: "proposals.errors.createdByAssistants",
    });
  }
  if (!z.uuid().safeParse(sourceEventId).success) {
    throw invalid("Evento de origem inválido.", "invalidProposal");
  }
  return insertProposal(tx, ctx, input, {
    apiKeyId: null,
    aiExecutionId: null,
    origin: "worker",
    proposalOrigin: "agent",
    sourceEventId,
  });
}

/** Validity of a new proposal: 24 hours, or the agent's (H4). */
export function proposalTtlMs(
  origin: ProposalOrigin,
  op: Pick<ProposalOperation, "agentTtlHours">,
): number {
  if (origin !== "agent") return PROPOSAL_TTL_MS;
  const hours = Math.min(
    Math.max(op.agentTtlHours ?? AGENT_PROPOSAL_MAX_TTL_HOURS, 1),
    AGENT_PROPOSAL_MAX_TTL_HOURS,
  );
  return hours * 60 * 60_000;
}

async function insertProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
  source: Readonly<{
    apiKeyId: string | null;
    aiExecutionId: string | null;
    origin: AuditOrigin;
    proposalOrigin: ProposalOrigin;
    sourceEventId: string | null;
  }>,
): Promise<{ proposal: ProposalView; created: boolean }> {
  const parsed = ProposeInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    if (!issue) throw invalid("Proposta inválida.", "invalidProposal");
    throw new AppError({
      code: "invalid_input",
      safeMessage: issue,
      // The schema's own message has a translation; zod's go as they are.
      ...(issue === IDEMPOTENCY_KEY_FORMAT
        ? { messageKey: "apiErrors.idempotencyKeyFormat" }
        : {
            messageKey: "apiErrors.validationIssue",
            messageValues: { message: issue },
          }),
    });
  }
  const { operation, targetId, idempotencyKey, reason } = parsed.data;
  const op = getProposalOperation(operation);
  if (!op) {
    throw invalid(`Operação desconhecida: ${operation}.`, "unknownOperation", {
      operation,
    });
  }
  if (op.needsTarget !== Boolean(targetId)) {
    throw op.needsTarget
      ? invalid("Esta operação precisa de targetId.", "needsTarget")
      : invalid("Esta operação não recebe targetId.", "noTarget");
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
        "idempotencyReused",
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
      messageKey: "proposals.errors.tooManyPending",
    });
  }

  const row = await tx.executionProposal.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      requestedBy: ctx.userId,
      apiKeyId: source.apiKeyId,
      aiExecutionId: source.aiExecutionId,
      origin: source.proposalOrigin,
      sourceEventId: source.sourceEventId,
      operation,
      targetId: targetId ?? null,
      payload: payload as Prisma.InputJsonObject,
      payloadHash,
      resourceVersion,
      reason: reason ?? null,
      idempotencyKey,
      expiresAt: new Date(
        Date.now() + proposalTtlMs(source.proposalOrigin, op),
      ),
    },
  });
  await recordAudit(tx, ctx, {
    action: "proposal.create",
    resourceType: "execution_proposal",
    resourceId: row.id,
    result: "success",
    origin: source.origin,
    metadata: { action: operation, target: targetId ?? null },
  });
  // The request is an event of the hub that waits for a decision (H4).
  await emitProposalEvent(tx, ctx, row, "requested", {
    origin: source.origin,
    causedBy: source.sourceEventId,
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

/**
 * Owner and admin see any proposal; the member who asked sees their own;
 * the managing partner sees those of the companies it manages (H4).
 */
export async function getProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposalId: string,
): Promise<ProposalView> {
  if (!z.string().uuid().safeParse(proposalId).success) throw notFound();
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  const reviewer = role
    ? workspaceRoleGrants(role, Permissions.WORKSPACE_PROPOSALS_REVIEW)
    : (await approverKind(tx, ctx)) === "partner";
  if (!role && !reviewer) throw notFound();
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
  const approver = await requireApprover(tx, ctx);
  requireMfa(assurance);
  const row = await lockProposal(tx, ctx, proposalId);
  if (!row) throw notFound();
  if (row.status !== "pending")
    throw conflict("Esta proposta já foi decidida.", "alreadyDecided");
  if (row.expiresAt.getTime() <= Date.now()) {
    throw conflict(
      "A proposta venceu. Peça ao assistente uma nova.",
      "expired",
    );
  }
  if (input.payloadHash !== row.payloadHash) {
    throw conflict(
      "O conteúdo não é o que estava na tela. Abra a proposta de novo.",
      "contentMismatch",
    );
  }
  if (hashOf(row) !== row.payloadHash) {
    throw conflict(
      "O conteúdo da proposta não confere com o registrado.",
      "contentTampered",
    );
  }
  const op = getProposalOperation(row.operation);
  if (!op) {
    throw invalid(
      "Operação desconhecida nesta versão.",
      "unknownOperationVersion",
    );
  }
  await assertModuleOperational(tx, ctx, op.moduleKey, "write");
  await requireWorkspacePermission(tx, ctx, op.permission);
  if (row.targetId) {
    const current = await op.version(tx, ctx, row.targetId);
    if (current !== row.resourceVersion) {
      throw conflict(
        "O registro mudou depois da proposta. Peça ao assistente uma nova.",
        "recordChanged",
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
  const origin: AuditOrigin = approver === "partner" ? "partner" : "app";
  await recordAudit(tx, ctx, {
    action: "proposal.approve",
    resourceType: "execution_proposal",
    resourceId: row.id,
    result: "success",
    origin,
    metadata: { action: row.operation, target: row.targetId },
  });
  // The hub hands the execution to `proposals.execute` (H4), which runs
  // it in this approver's context.
  await emitProposalEvent(tx, ctx, updated, "approved", { origin });
  await syncProposalEvent(tx, row.id);
  return toView(updated, ctx);
}

export async function rejectProposal(
  tx: ContextTransaction,
  ctx: RequestContext,
  proposalId: string,
): Promise<ProposalView> {
  requirePerson(ctx);
  const approver = await requireApprover(tx, ctx);
  const row = await lockProposal(tx, ctx, proposalId);
  if (!row) throw notFound();
  if (row.status !== "pending")
    throw conflict("Esta proposta já foi decidida.", "alreadyDecided");
  const updated = await tx.executionProposal.update({
    where: { id: row.id },
    data: { status: "rejected", decidedBy: ctx.userId, decidedAt: new Date() },
  });
  const origin: AuditOrigin = approver === "partner" ? "partner" : "app";
  await recordAudit(tx, ctx, {
    action: "proposal.reject",
    resourceType: "execution_proposal",
    resourceId: row.id,
    result: "success",
    origin,
    metadata: { action: row.operation, target: row.targetId },
  });
  await emitProposalEvent(tx, ctx, updated, "rejected", { origin });
  await syncProposalEvent(tx, row.id);
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
  options: Readonly<{ causedBy?: string | null }> = {},
): Promise<ExecuteSummary> {
  // Without the permission the row cannot be updated either: the job fails
  // and the proposal stays approved until it expires. The approver is
  // checked again by the service mode (H4).
  await requireApprover(tx, ctx);
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
    const updated = await tx.executionProposal.update({
      where: { id: row.id },
      data: {
        status,
        executedAt: new Date(),
        errorCode: error,
        result: resourceId ? { resourceId } : Prisma.DbNull,
      },
    });
    await emitProposalEvent(tx, ctx, updated, status, {
      origin: "worker",
      causedBy: options.causedBy ?? null,
      error,
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
