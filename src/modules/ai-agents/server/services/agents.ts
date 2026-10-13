import "server-only";

import { z } from "zod";

import {
  agentKindOfTemplate,
  CURRENT_CONFIG_VERSION,
  parseAgentConfig,
} from "@/core/ai/config/schema";
import { recordAudit } from "@/core/audit/record";
import { assertWithinQuota, resolveQuota } from "@/core/entitlements/quotas";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { AI_AGENTS_MAX_QUOTA } from "../../manifest";

/**
 * GUIDS of the workspace (A1): the agents of the customer, created from a
 * published template or blank ("Personalizado"), within the plan limit
 * (D-AG-16). The screens arrive in A4; the partner side in A3. RLS repeats
 * tenant and role in the database.
 */

const MODULE_KEY = "ai-agents";

export type GuidDto = Readonly<{
  id: string;
  name: string | null;
  status: string;
  templateId: string | null;
  templateVersion: number | null;
  customized: boolean;
  keyState: string;
  /** Set when the partner made the last change ("Alterado por …"). */
  updatedByPartnerId: string | null;
  updatedAt: string;
}>;

export type GuidTemplateDto = Readonly<{
  id: string;
  name: string;
  description: string | null;
  segment: string | null;
  version: number;
  /** House template (null) or the partner's. */
  partnerId: string | null;
}>;

type AgentRow = {
  id: string;
  config: unknown;
  status: string;
  templateId: string | null;
  templateVersion: number | null;
  customized: boolean;
  keyState: string;
  updatedByPartnerId: string | null;
  updatedAt: Date;
};

function agentName(config: unknown): string | null {
  const name = (config as { overview?: { agent_name?: unknown } } | null)
    ?.overview?.agent_name;
  return typeof name === "string" && name.trim() ? name : null;
}

function toDto(row: AgentRow): GuidDto {
  return {
    id: row.id,
    name: agentName(row.config),
    status: row.status,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    customized: row.customized,
    keyState: row.keyState,
    updatedByPartnerId: row.updatedByPartnerId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function templateNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Modelo de agente não encontrado.",
    messageKey: "apiErrors.notFound",
  });
}

function invalidTemplate(): AppError {
  return new AppError({
    code: "internal",
    safeMessage: "A configuração do modelo de agente é inválida.",
  });
}

/** The template to start from; null is "Personalizado" (blank). */
export const GuidCreateInput = z.strictObject({
  templateId: z.uuid().nullable(),
});

/** Published GUIDS templates of the house and of the workspace's partner. */
export async function listGuidTemplates(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<GuidTemplateDto[]> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  const rows = await tx.aiAgentTemplate.findMany({
    where: { kind: "guid", published: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      segment: true,
      version: true,
      partnerId: true,
    },
  });
  return rows;
}

export async function listGuids(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<GuidDto[]> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  const rows = await tx.aiAgent.findMany({
    where: { kind: "guid", workspaceId: ctx.workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toDto);
}

/**
 * Creates a GUIDS as a draft, copying the whole configuration of the
 * template (a new field never stays behind), under the plan limit counted
 * with the workspace lock. The customer's own key does not lift the limit.
 */
export async function createGuid(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<GuidDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
  const parsed = GuidCreateInput.safeParse(input);
  if (!parsed.success) throw templateNotFound();

  let source: Readonly<{
    templateId: string | null;
    templateVersion: number | null;
    config: object;
  }> = { templateId: null, templateVersion: null, config: {} };
  if (parsed.data.templateId) {
    // RLS shows only the published templates this workspace may use.
    const template = await tx.aiAgentTemplate.findFirst({
      where: { id: parsed.data.templateId, kind: "guid", published: true },
    });
    if (!template) throw templateNotFound();
    const config = parseAgentConfig(
      agentKindOfTemplate("guid"),
      template.configVersion,
      template.defaults,
    );
    if (!config.success) throw invalidTemplate();
    // Templates of the A1 keep the prompt only in `prompt_template` (A3a).
    if (
      !config.data.overview.system_prompt?.trim() &&
      template.promptTemplate.trim()
    ) {
      config.data.overview.system_prompt = template.promptTemplate;
    }
    source = {
      templateId: template.id,
      templateVersion: template.version,
      config: config.data,
    };
  }

  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`ai_agents:${ctx.workspaceId}`}))`;
  const [count, quota] = await Promise.all([
    tx.aiAgent.count({ where: { workspaceId: ctx.workspaceId, kind: "guid" } }),
    resolveQuota(tx, ctx.organizationId, AI_AGENTS_MAX_QUOTA),
  ]);
  assertWithinQuota(quota, count, "agentes de IA (GUIDS) por workspace");

  const row = await tx.aiAgent.create({
    data: {
      kind: "guid",
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      templateId: source.templateId,
      templateVersion: source.templateVersion,
      customized: source.templateId === null,
      config: source.config,
      configVersion: CURRENT_CONFIG_VERSION,
      createdBy: ctx.userId,
    },
  });
  await recordAudit(tx, ctx, {
    action: "ai_agents.guid.create",
    resourceType: "ai_agent",
    resourceId: row.id,
    result: "success",
    origin: ctx.principalType === "api_key" ? "api" : "app",
    metadata: { name: agentName(row.config) ?? "", status: row.status },
  });
  return toDto(row);
}
