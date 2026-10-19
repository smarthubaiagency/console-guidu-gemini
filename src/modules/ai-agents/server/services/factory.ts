import "server-only";

import {
  CURRENT_CONFIG_VERSION,
  parseAgentConfig,
} from "@/core/ai/config/schema";
import { recordAudit } from "@/core/audit/record";
import { resolveQuota } from "@/core/entitlements/quotas";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  FACTORY_ROLES,
  type FactoryRole,
  rolesToCreate,
} from "../../factory-roles";
import { AI_AGENTS_MAX_QUOTA } from "../../manifest";

export { isFactoryRole } from "../../factory-roles";

/**
 * The four factory GUIDS (GF1, docs/architecture/plano-gf1-tr1.md): every
 * workspace of the module has ops, the orchestrator ("Recepção"), the
 * attendant and the seller, copied from the house templates as drafts.
 * They are never deleted (the screen deactivates them); one that went away
 * comes back off. The attendant is born customized, so the customer edits
 * its prompt; the others follow the template.
 */

/** Born customized: the prompt is the customer's (decision of 19/10/2026). */
const CUSTOMIZED: ReadonlySet<FactoryRole> = new Set(["attendant"]);

const DEFAULT_AVATAR: Readonly<Record<FactoryRole, string>> = {
  ops: "briefcase:neutral",
  orchestrator: "headset:info",
  attendant: "smile:success",
  seller: "shopping-bag:warning",
};

/** The factory template's configuration, with the prompt (A3b). */
async function templateOf(tx: ContextTransaction, role: FactoryRole) {
  const template = await tx.aiAgentTemplate.findFirst({
    where: { factoryRole: role, kind: "guid", published: true },
  });
  if (!template) return null;
  const config = parseAgentConfig(
    "guid",
    template.configVersion,
    template.defaults,
  );
  if (!config.success) {
    throw new AppError({
      code: "internal",
      safeMessage: "A configuração do modelo de agente é inválida.",
    });
  }
  if (
    !config.data.overview.system_prompt?.trim() &&
    template.promptTemplate.trim()
  ) {
    config.data.overview.system_prompt = template.promptTemplate;
  }
  return { template, config: config.data };
}

export type FactorySeed = Readonly<{
  created: FactoryRole[];
  /** Roles that did not fit under the plan limit. */
  skipped: FactoryRole[];
}>;

/**
 * Creates the factory GUIDS the workspace is missing, as drafts, within the
 * plan limit (counted under the workspace lock, as `createGuid` does).
 * Idempotent; called by whoever manages the module when the page opens.
 */
export async function ensureFactoryGuids(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<FactorySeed> {
  const existing = await tx.aiAgent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      kind: "guid",
      factoryRole: { not: null },
    },
    select: { factoryRole: true },
  });
  const have = new Set(existing.map((row) => row.factoryRole));
  const missing = FACTORY_ROLES.filter((role) => !have.has(role));
  if (missing.length === 0) return { created: [], skipped: [] };

  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`ai_agents:${ctx.workspaceId}`}))`;
  const [count, quota] = await Promise.all([
    tx.aiAgent.count({ where: { workspaceId: ctx.workspaceId, kind: "guid" } }),
    resolveQuota(tx, ctx.organizationId, AI_AGENTS_MAX_QUOTA),
  ]);
  const roles = rolesToCreate(missing, count, quota.limit);
  const created: FactoryRole[] = [];
  for (const role of roles) {
    const source = await templateOf(tx, role);
    if (!source) continue;
    const row = await tx.aiAgent.create({
      data: {
        kind: "guid",
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        templateId: source.template.id,
        templateVersion: source.template.version,
        customized: CUSTOMIZED.has(role),
        factoryRole: role,
        avatar: DEFAULT_AVATAR[role],
        config: source.config,
        configVersion: CURRENT_CONFIG_VERSION,
        createdBy: ctx.userId,
      },
      select: { id: true, status: true },
    });
    created.push(role);
    await recordAudit(tx, ctx, {
      action: "ai_agents.guid.create",
      resourceType: "ai_agent",
      resourceId: row.id,
      result: "success",
      origin: ctx.principalType === "api_key" ? "api" : "app",
      metadata: {
        name: source.config.overview.agent_name ?? "",
        status: row.status,
        factory: true,
        role,
      },
    });
  }
  return {
    created,
    skipped: missing.filter((role) => !created.includes(role)),
  };
}

/**
 * "Restaurar prompt de fábrica": the prompt of the current version of the
 * factory template comes back. The configuration changes, so the agent
 * needs a new test before it is turned on again (A4b).
 */
export async function factoryPrompt(
  tx: ContextTransaction,
  role: FactoryRole,
): Promise<string | null> {
  const source = await templateOf(tx, role);
  return source?.config.overview.system_prompt ?? null;
}
