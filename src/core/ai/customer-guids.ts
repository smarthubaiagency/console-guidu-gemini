import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  applyConfigEdit,
  configFieldErrors,
  missingConfigFields,
} from "./config/editing";
import {
  type AgentConfig,
  AgentConfigV1,
  CURRENT_CONFIG_VERSION,
  parseAgentConfig,
} from "./config/schema";
import { ConfigValidationError } from "./templates";

/**
 * The GUIDS of the partner's customers in `/admin` (A3c, especificação §5.2
 * and §6): the partner reads and changes their configuration (editor
 * `partner`: every field but the customer's key, which stays in the
 * customer's vault) and their referrals, without a support grant.
 * Conversations, leads and the knowledge base keep needing the grant. Each
 * change signs the row with the partner (`updated_by_partner_id`), which the
 * customer sees as "Alterado por <parceiro> em <data>", and is audited.
 * Reading needs `partner.ai_agents.read`, changing `partner.ai_agents.manage`;
 * RLS repeats both and limits everything to the partner's companies. Runs in
 * withIdentityContext with the partner's id.
 */

export type CustomerGuidActor = Readonly<{
  userId: string;
  partnerId: string;
  partnerRole: PartnerRoleKey | null;
}>;

export const GUID_STATUSES = ["draft", "active", "paused"] as const;

export type CustomerGuidSummaryDto = Readonly<{
  id: string;
  name: string | null;
  status: string;
  customerId: string;
  customerName: string;
  customized: boolean;
  keyState: string;
  model: string | null;
  /** The last change was made by this partner. */
  changedByPartner: boolean;
  updatedAt: string;
}>;

export type ReferralDto = Readonly<{
  id: string;
  name: string;
  referralTag: string;
  specialties: readonly string[];
  phone: string | null;
  city: string | null;
  remote: boolean;
}>;

export type CustomerGuidDetailDto = CustomerGuidSummaryDto &
  Readonly<{
    config: AgentConfig;
    configValid: boolean;
    /** Minimum fields still empty (campos.md §9). */
    missing: readonly string[];
    referrals: readonly ReferralDto[];
  }>;

export const CustomerGuidFilters = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  status: z.enum(GUID_STATUSES).optional().catch(undefined),
});

export type CustomerGuidFilters = z.output<typeof CustomerGuidFilters>;

export const CustomerGuidUpdateInput = z.strictObject({
  status: z.enum(["active", "paused"]),
  config: z.unknown(),
});

export const ReferralInput = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, { error: "Informe o nome." })
    .max(160, { error: "Use até 160 caracteres." }),
  referralTag: z
    .string()
    .trim()
    .toLowerCase()
    .max(60, { error: "Use até 60 caracteres." })
    .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, {
      error: "Use letras minúsculas, números, - ou _.",
    }),
  specialties: z
    .array(z.string().trim().min(1).max(80))
    .max(50, { error: "Use até 50 especialidades." }),
  phone: z
    .string()
    .trim()
    .regex(/^(\+[1-9][0-9]{7,14})?$/, {
      error: "Use o formato internacional, como +5511999998888.",
    })
    .transform((v) => v || null),
  city: z
    .string()
    .trim()
    .max(120, { error: "Use até 120 caracteres." })
    .transform((v) => v || null),
  remote: z.boolean(),
});

export type ReferralInput = z.input<typeof ReferralInput>;

function requireRole(
  actor: CustomerGuidActor,
  permission:
    | typeof Permissions.PARTNER_AI_AGENTS_READ
    | typeof Permissions.PARTNER_AI_AGENTS_MANAGE,
): void {
  if (
    !actor.partnerRole ||
    !hasPartnerRolePermission(actor.partnerRole, permission)
  ) {
    throw new PermissionDeniedError();
  }
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Agente não encontrado.",
    messageKey: "apiErrors.notFound",
  });
}

function referralNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Indicação não encontrada.",
    messageKey: "apiErrors.notFound",
  });
}

const AGENT_SELECT = {
  id: true,
  organizationId: true,
  workspaceId: true,
  status: true,
  config: true,
  configVersion: true,
  customized: true,
  keyState: true,
  updatedByPartnerId: true,
  updatedAt: true,
} as const;

type AgentRow = {
  id: string;
  organizationId: string | null;
  workspaceId: string | null;
  status: string;
  config: unknown;
  configVersion: number;
  customized: boolean;
  keyState: string;
  updatedByPartnerId: string | null;
  updatedAt: Date;
};

const REFERRAL_SELECT = {
  id: true,
  name: true,
  referralTag: true,
  specialties: true,
  phone: true,
  city: true,
  remote: true,
} as const;

function parsedConfig(row: AgentRow) {
  const parsed = parseAgentConfig("guid", row.configVersion, row.config);
  return {
    config: parsed.success ? parsed.data : AgentConfigV1.parse({}),
    configValid: parsed.success,
  };
}

function toSummary(
  row: AgentRow,
  config: AgentConfig,
  customers: ReadonlyMap<string, string>,
  actor: CustomerGuidActor,
): CustomerGuidSummaryDto {
  const name = config.overview.agent_name?.trim();
  return {
    id: row.id,
    name: name || null,
    status: row.status,
    customerId: row.organizationId ?? "",
    customerName: customers.get(row.organizationId ?? "") ?? "",
    customized: row.customized,
    keyState: row.keyState,
    model: config.model.model_name?.trim() || null,
    changedByPartner: row.updatedByPartnerId === actor.partnerId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The partner's companies, by id; RLS shows only these. */
export async function listGuidCustomers(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
): Promise<Map<string, string>> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_READ);
  const rows = await tx.organization.findMany({
    where: { partnerId: actor.partnerId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The GUIDS of the partner's customers, the most recently changed first,
 * filtered by customer, status and a search on the agent's or the
 * customer's name.
 */
export async function listCustomerGuids(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  filters: CustomerGuidFilters = {},
): Promise<CustomerGuidSummaryDto[]> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_READ);
  const customers = await listGuidCustomers(tx, actor);
  const rows = await tx.aiAgent.findMany({
    where: {
      kind: "guid",
      organizationId: filters.customer ?? { in: [...customers.keys()] },
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: AGENT_SELECT,
  });
  const query = filters.q?.toLocaleLowerCase("pt-BR");
  return rows
    .map((row) => toSummary(row, parsedConfig(row).config, customers, actor))
    .filter(
      (guid) =>
        !query ||
        (guid.name ?? "").toLocaleLowerCase("pt-BR").includes(query) ||
        guid.customerName.toLocaleLowerCase("pt-BR").includes(query),
    );
}

async function loadAgent(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  agentId: string,
): Promise<AgentRow & { organizationId: string; workspaceId: string }> {
  if (!z.uuid().safeParse(agentId).success) throw notFound();
  const row = await tx.aiAgent.findFirst({
    where: { id: agentId, kind: "guid" },
    select: AGENT_SELECT,
  });
  // RLS shows only the GUIDS of the partner's companies; the check repeats it.
  if (
    !row?.organizationId ||
    !row.workspaceId ||
    !(await tx.organization.findFirst({
      where: { id: row.organizationId, partnerId: actor.partnerId },
      select: { id: true },
    }))
  ) {
    throw notFound();
  }
  return {
    ...row,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
  };
}

export async function getCustomerGuid(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  agentId: string,
): Promise<CustomerGuidDetailDto> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_READ);
  const row = await loadAgent(tx, actor, agentId);
  const customers = await listGuidCustomers(tx, actor);
  const { config, configValid } = parsedConfig(row);
  const referrals = await tx.aiAgentReferral.findMany({
    where: { workspaceId: row.workspaceId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: REFERRAL_SELECT,
  });
  return {
    ...toSummary(row, config, customers, actor),
    config,
    configValid,
    missing: missingConfigFields(config, "partner"),
    referrals,
  };
}

/** The list and, when `?edit=` names one, the opened GUIDS. */
export async function loadCustomerGuidsView(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  filters: CustomerGuidFilters,
  editKey: string | null,
): Promise<{
  guids: CustomerGuidSummaryDto[];
  customers: Map<string, string>;
  opened: CustomerGuidDetailDto | null;
}> {
  const guids = await listCustomerGuids(tx, actor, filters);
  const customers = await listGuidCustomers(tx, actor);
  let opened: CustomerGuidDetailDto | null = null;
  if (editKey) {
    try {
      opened = await getCustomerGuid(tx, actor, editKey);
    } catch (err) {
      if (!(err instanceof AppError && err.code === "not_found")) throw err;
    }
  }
  return { guids, customers, opened };
}

/**
 * Saves the configuration and the status of a customer's GUIDS. The key
 * stays the customer's; turning it on needs the minimum fields, turning it
 * off is always allowed and keeps a draft a draft.
 */
export async function updateCustomerGuid(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  agentId: string,
  input: unknown,
): Promise<CustomerGuidDetailDto> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_MANAGE);
  const parsed = CustomerGuidUpdateInput.safeParse(input);
  if (!parsed.success) {
    throw new ConfigValidationError(configFieldErrors(parsed.error));
  }
  const row = await loadAgent(tx, actor, agentId);
  const edit = applyConfigEdit(
    parsedConfig(row).config,
    parsed.data.config,
    "partner",
  );
  if (edit.forbidden.length > 0) {
    throw new ConfigValidationError(
      Object.fromEntries(
        edit.forbidden.map((path) => [path, "Este campo não é do parceiro."]),
      ),
    );
  }
  const config = parseAgentConfig("guid", CURRENT_CONFIG_VERSION, edit.config);
  if (!config.success) {
    throw new ConfigValidationError(configFieldErrors(config.error));
  }
  const status =
    parsed.data.status === "paused" && row.status === "draft"
      ? "draft"
      : parsed.data.status;
  if (status === "active") {
    const missing = missingConfigFields(config.data, "partner");
    if (missing.length > 0) {
      throw new ConfigValidationError(
        Object.fromEntries(
          missing.map((path) => [path, "Preencha para ativar o agente."]),
        ),
      );
    }
  }

  const fields = [
    ...(status !== row.status ? ["status"] : []),
    ...edit.changed,
  ];
  if (fields.length > 0) {
    await tx.aiAgent.update({
      where: { id: row.id },
      data: {
        config: config.data,
        configVersion: CURRENT_CONFIG_VERSION,
        status,
        updatedBy: actor.userId,
        updatedByPartnerId: actor.partnerId,
      },
      select: { id: true },
    });
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: "ai.guid.partner_update",
      resourceType: "ai_agent",
      resourceId: row.id,
      result: "success",
      origin: "admin",
      metadata: {
        partnerId: actor.partnerId,
        agentId: row.id,
        fields,
        from: { status: row.status },
        to: { status },
        model: config.data.model.model_name ?? "",
      },
    });
  }
  return getCustomerGuid(tx, actor, row.id);
}

function parseReferral(input: unknown) {
  const parsed = ReferralInput.safeParse(input);
  if (!parsed.success) {
    throw new ConfigValidationError(configFieldErrors(parsed.error));
  }
  return parsed.data;
}

async function assertTagFree(
  tx: ContextTransaction,
  workspaceId: string,
  referralTag: string,
  exceptId?: string,
): Promise<void> {
  const taken = await tx.aiAgentReferral.findFirst({
    where: {
      workspaceId,
      referralTag,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (taken) {
    throw new ConfigValidationError({
      referralTag: "Já existe uma indicação com esta tag neste cliente.",
    });
  }
}

async function auditReferral(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  action: "create" | "update" | "delete",
  referral: Readonly<{ id: string; name: string; referralTag: string }>,
  agentId: string,
  fields?: readonly string[],
): Promise<void> {
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: `ai.referral.partner_${action}`,
    resourceType: "ai_agent_referral",
    resourceId: referral.id,
    result: "success",
    origin: "admin",
    metadata: {
      partnerId: actor.partnerId,
      agentId,
      name: referral.name,
      target: referral.referralTag,
      ...(fields ? { fields } : {}),
    },
  });
}

/** Adds a referral to the workspace of a customer's GUIDS. */
export async function createCustomerReferral(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  agentId: string,
  input: unknown,
): Promise<ReferralDto> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_MANAGE);
  const data = parseReferral(input);
  const agent = await loadAgent(tx, actor, agentId);
  await assertTagFree(tx, agent.workspaceId, data.referralTag);
  const created = await tx.aiAgentReferral.create({
    data: {
      ...data,
      organizationId: agent.organizationId,
      workspaceId: agent.workspaceId,
      createdBy: actor.userId,
    },
    select: REFERRAL_SELECT,
  });
  await auditReferral(tx, actor, "create", created, agent.id);
  return created;
}

async function loadReferral(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  agentId: string,
  referralId: string,
) {
  const agent = await loadAgent(tx, actor, agentId);
  if (!z.uuid().safeParse(referralId).success) throw referralNotFound();
  const referral = await tx.aiAgentReferral.findFirst({
    where: { id: referralId, workspaceId: agent.workspaceId },
    select: REFERRAL_SELECT,
  });
  if (!referral) throw referralNotFound();
  return { agent, referral };
}

export async function updateCustomerReferral(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  agentId: string,
  referralId: string,
  input: unknown,
): Promise<ReferralDto> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_MANAGE);
  const data = parseReferral(input);
  const { agent, referral } = await loadReferral(
    tx,
    actor,
    agentId,
    referralId,
  );
  await assertTagFree(tx, agent.workspaceId, data.referralTag, referral.id);
  const fields = (Object.keys(data) as (keyof typeof data)[]).filter(
    (key) => JSON.stringify(data[key]) !== JSON.stringify(referral[key]),
  );
  if (fields.length === 0) return referral;
  const saved = await tx.aiAgentReferral.update({
    where: { id: referral.id },
    data: { ...data, updatedBy: actor.userId },
    select: REFERRAL_SELECT,
  });
  await auditReferral(tx, actor, "update", saved, agent.id, fields);
  return saved;
}

export async function deleteCustomerReferral(
  tx: ContextTransaction,
  actor: CustomerGuidActor,
  agentId: string,
  referralId: string,
): Promise<void> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_MANAGE);
  const { agent, referral } = await loadReferral(
    tx,
    actor,
    agentId,
    referralId,
  );
  await tx.aiAgentReferral.delete({ where: { id: referral.id } });
  await auditReferral(tx, actor, "delete", referral, agent.id);
}
