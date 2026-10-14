import "server-only";

import { z } from "zod";

import {
  applyConfigEdit,
  type ConfigEditor,
  configFieldErrors,
  missingConfigFields,
} from "@/core/ai/config/editing";
import {
  type AgentConfig,
  AgentConfigV1,
  CURRENT_CONFIG_VERSION,
  parseAgentConfig,
} from "@/core/ai/config/schema";
import { ReferralInput, type ReferralDto } from "@/core/ai/customer-guids";
import { voiceOptions } from "@/core/ai/media";
import { ConfigValidationError } from "@/core/ai/templates";
import { recordAudit } from "@/core/audit/record";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { type GuidDto, listGuids } from "./agents";

/**
 * A GUIDS in the workspace's own screens (A4a, especificação §5.1 and §5.2):
 * the customer opens it, changes the model connection with a key of the
 * workspace's vault and turns it on or off; once customized, the
 * configuration is the GUIDS's and the customer also changes the overview,
 * scope, rules and referrals, never the tools, the expected output or the
 * leads' destination. Reading needs `ai_agents.use`; changing, customizing
 * and deleting need `ai_agents.manage`. RLS repeats tenant and role; a
 * workspace change clears the partner's signature ("Alterado por …").
 *
 * Turning a GUIDS on needs a successful "Testar agente" of its current
 * configuration (A4b, §5.3): the engine records the version that passed
 * (`tested_config_hash`), and any change after it asks for a new test. An
 * agent already on stays on when its configuration changes; the screen says
 * the new version was not tested.
 */

const MODULE_KEY = "ai-agents";

export type GuidDetailDto = GuidDto &
  Readonly<{
    config: AgentConfig;
    configValid: boolean;
    /** The customer's editor: the model only, or everything it may change. */
    editor: Extract<ConfigEditor, "customer" | "customer_custom">;
    /** Minimum fields still empty (campos.md §9). */
    missing: readonly string[];
    lastTestedAt: string | null;
    /** When the last successful "Testar agente" answered. */
    testedAt: string | null;
    /** Whether that test was of the configuration saved now. */
    testedCurrent: boolean;
    /** The workspace's referrals; editable once the GUIDS is customized. */
    referrals: readonly ReferralDto[];
  }>;

export const GuidUpdateInput = z.strictObject({
  status: z.enum(["active", "paused"]),
  config: z.unknown(),
});

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

function notCustomized(): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: "Personalize o agente para alterar as indicações.",
    messageKey: "aiAgents.errors.notCustomized",
  });
}

const REFERRAL_SELECT = {
  id: true,
  name: true,
  referralTag: true,
  specialties: true,
  phone: true,
  city: true,
  remote: true,
} as const;

function editorOf(customized: boolean): GuidDetailDto["editor"] {
  return customized ? "customer_custom" : "customer";
}

function origin(ctx: RequestContext): "api" | "app" {
  return ctx.principalType === "api_key" ? "api" : "app";
}

async function loadAgent(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
) {
  if (!z.uuid().safeParse(agentId).success) throw notFound();
  const row = await tx.aiAgent.findFirst({
    where: { id: agentId, kind: "guid", workspaceId: ctx.workspaceId },
  });
  if (!row) throw notFound();
  return row;
}

/** Whether the saved configuration is the one that passed the test. */
async function testedCurrent(
  tx: ContextTransaction,
  agentId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ tested: boolean | null }[]>`
    select md5(config::text) = tested_config_hash as tested
    from public.ai_agents where id = ${agentId}::uuid
  `;
  return rows[0]?.tested === true;
}

function parsedConfig(row: { config: unknown; configVersion: number }) {
  const parsed = parseAgentConfig("guid", row.configVersion, row.config);
  return {
    config: parsed.success ? parsed.data : AgentConfigV1.parse({}),
    configValid: parsed.success,
  };
}

export async function getGuid(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
): Promise<GuidDetailDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  const row = await loadAgent(tx, ctx, agentId);
  // The summary carries the partner's name ("Alterado por …").
  const summary = (await listGuids(tx, ctx)).find((g) => g.id === row.id);
  if (!summary) throw notFound();
  const { config, configValid } = parsedConfig(row);
  const editor = editorOf(row.customized);
  const referrals = await tx.aiAgentReferral.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: REFERRAL_SELECT,
  });
  return {
    ...summary,
    config,
    configValid,
    editor,
    missing: missingConfigFields(config, editor),
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    testedAt: row.testedAt?.toISOString() ?? null,
    testedCurrent: await testedCurrent(tx, row.id),
    referrals,
  };
}

/**
 * Saves the configuration and the status. The provider follows the chosen
 * key of the workspace's vault; turning it on needs the minimum fields, a
 * working key and a successful test of the configuration being saved;
 * turning it off is always allowed and keeps a draft a draft.
 */
export async function updateGuid(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
  input: unknown,
): Promise<GuidDetailDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
  const parsed = GuidUpdateInput.safeParse(input);
  if (!parsed.success) {
    throw new ConfigValidationError(configFieldErrors(parsed.error));
  }
  const row = await loadAgent(tx, ctx, agentId);
  const editor = editorOf(row.customized);
  const edit = applyConfigEdit(
    parsedConfig(row).config,
    parsed.data.config,
    editor,
  );
  if (edit.forbidden.length > 0) {
    throw new ConfigValidationError(
      Object.fromEntries(
        edit.forbidden.map((path) => [
          path,
          row.customized
            ? "Este campo não é do cliente."
            : "Personalize o agente para alterar este campo.",
        ]),
      ),
    );
  }

  const model = edit.config.model;
  delete model.model_provider;
  if (typeof model.credential_id === "string") {
    const credential = await tx.credential.findFirst({
      where: {
        id: model.credential_id,
        workspaceId: ctx.workspaceId,
        status: "active",
        purpose: { in: ["chat", "all"] },
      },
      select: { provider: true },
    });
    if (!credential) {
      throw new ConfigValidationError({
        "model.credential_id": "A chave escolhida não está ativa no cofre.",
      });
    }
    model.model_provider = credential.provider;
  }
  await checkVoiceAndEmbeddingKeys(tx, ctx, model);

  const config = parseAgentConfig("guid", CURRENT_CONFIG_VERSION, edit.config);
  if (!config.success) {
    throw new ConfigValidationError(configFieldErrors(config.error));
  }
  const status =
    parsed.data.status === "paused" && row.status === "draft"
      ? "draft"
      : parsed.data.status;
  if (status === "active") {
    const missing = missingConfigFields(config.data, editor);
    if (missing.length > 0) {
      throw new ConfigValidationError(
        Object.fromEntries(
          missing.map((path) => [path, "Preencha para ativar o agente."]),
        ),
      );
    }
    // A key that failed is tested again before the agent answers anyone.
    const keyChanged = edit.changed.includes("model.credential_id");
    if (row.keyState !== "ok" && !keyChanged) {
      throw new ConfigValidationError({
        "model.credential_id": "Teste a chave antes de ativar o agente.",
      });
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
        updatedBy: ctx.userId,
        updatedByPartnerId: null,
      },
      select: { id: true },
    });
    // Checked on the saved row (same transaction, undone on refusal): the
    // hash is the database's.
    if (
      status === "active" &&
      row.status !== "active" &&
      !(await testedCurrent(tx, row.id))
    ) {
      throw new ConfigValidationError({
        active: "Teste o agente nesta configuração antes de ativá-lo.",
      });
    }
    await recordAudit(tx, ctx, {
      action: "ai_agents.guid.update",
      resourceType: "ai_agent",
      resourceId: row.id,
      result: "success",
      origin: origin(ctx),
      metadata: {
        agentId: row.id,
        fields,
        from: { status: row.status },
        to: { status },
        model: config.data.model.model_name ?? "",
      },
    });
  }
  return getGuid(tx, ctx, row.id);
}

/**
 * Makes the configuration the GUIDS's own (§5.2): from now on the customer
 * also changes the overview, scope, rules and referrals; the template stays
 * only as a reference. There is no way back.
 */
export async function customizeGuid(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
): Promise<GuidDetailDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
  const row = await loadAgent(tx, ctx, agentId);
  if (!row.customized) {
    await tx.aiAgent.update({
      where: { id: row.id },
      data: {
        customized: true,
        updatedBy: ctx.userId,
        updatedByPartnerId: null,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: "ai_agents.guid.customize",
      resourceType: "ai_agent",
      resourceId: row.id,
      result: "success",
      origin: origin(ctx),
      metadata: { agentId: row.id },
    });
  }
  return getGuid(tx, ctx, row.id);
}

/** Deletes a GUIDS; its conversations go with it, the usage stays. */
export async function deleteGuid(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
): Promise<void> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
  const row = await loadAgent(tx, ctx, agentId);
  const { config } = parsedConfig(row);
  await tx.aiAgent.delete({ where: { id: row.id } });
  await recordAudit(tx, ctx, {
    action: "ai_agents.guid.delete",
    resourceType: "ai_agent",
    resourceId: row.id,
    result: "success",
    origin: origin(ctx),
    metadata: {
      agentId: row.id,
      name: config.overview.agent_name ?? "",
      status: row.status,
    },
  });
}

// ----------------------------------------------------------------------------
// Referrals: the workspace's, changed from a customized GUIDS
// ----------------------------------------------------------------------------

async function customizedAgent(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
) {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
  const row = await loadAgent(tx, ctx, agentId);
  if (!row.customized) throw notCustomized();
  return row;
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
  ctx: RequestContext,
  referralTag: string,
  exceptId?: string,
): Promise<void> {
  const taken = await tx.aiAgentReferral.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      referralTag,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (taken) {
    throw new ConfigValidationError({
      referralTag: "Já existe uma indicação com esta tag.",
    });
  }
}

async function auditReferral(
  tx: ContextTransaction,
  ctx: RequestContext,
  action: "create" | "update" | "delete",
  referral: Readonly<{ id: string; name: string; referralTag: string }>,
  agentId: string,
  fields?: readonly string[],
): Promise<void> {
  await recordAudit(tx, ctx, {
    action: `ai_agents.referral.${action}`,
    resourceType: "ai_agent_referral",
    resourceId: referral.id,
    result: "success",
    origin: origin(ctx),
    metadata: {
      agentId,
      name: referral.name,
      target: referral.referralTag,
      ...(fields ? { fields } : {}),
    },
  });
}

export async function createReferral(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
  input: unknown,
): Promise<ReferralDto> {
  const agent = await customizedAgent(tx, ctx, agentId);
  const data = parseReferral(input);
  await assertTagFree(tx, ctx, data.referralTag);
  const created = await tx.aiAgentReferral.create({
    data: {
      ...data,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
    },
    select: REFERRAL_SELECT,
  });
  await auditReferral(tx, ctx, "create", created, agent.id);
  return created;
}

async function loadReferral(
  tx: ContextTransaction,
  ctx: RequestContext,
  referralId: string,
) {
  if (!z.uuid().safeParse(referralId).success) throw referralNotFound();
  const referral = await tx.aiAgentReferral.findFirst({
    where: { id: referralId, workspaceId: ctx.workspaceId },
    select: REFERRAL_SELECT,
  });
  if (!referral) throw referralNotFound();
  return referral;
}

export async function updateReferral(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
  referralId: string,
  input: unknown,
): Promise<ReferralDto> {
  const agent = await customizedAgent(tx, ctx, agentId);
  const data = parseReferral(input);
  const referral = await loadReferral(tx, ctx, referralId);
  await assertTagFree(tx, ctx, data.referralTag, referral.id);
  const fields = (Object.keys(data) as (keyof typeof data)[]).filter(
    (key) => JSON.stringify(data[key]) !== JSON.stringify(referral[key]),
  );
  if (fields.length === 0) return referral;
  const saved = await tx.aiAgentReferral.update({
    where: { id: referral.id },
    data: { ...data, updatedBy: ctx.userId },
    select: REFERRAL_SELECT,
  });
  await auditReferral(tx, ctx, "update", saved, agent.id, fields);
  return saved;
}

export async function deleteReferral(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
  referralId: string,
): Promise<void> {
  const agent = await customizedAgent(tx, ctx, agentId);
  const referral = await loadReferral(tx, ctx, referralId);
  await tx.aiAgentReferral.delete({ where: { id: referral.id } });
  await auditReferral(tx, ctx, "delete", referral, agent.id);
}

/**
 * The voice and the embeddings keys (A5d): active keys of the workspace's
 * vault, the voice one of a provider that speaks, and a voice from that
 * provider's list. No voice key means the text key, when it speaks.
 */
async function checkVoiceAndEmbeddingKeys(
  tx: ContextTransaction,
  ctx: RequestContext,
  model: Record<string, unknown>,
): Promise<void> {
  const errors: Record<string, string> = {};
  let voiceProvider =
    typeof model.model_provider === "string" ? model.model_provider : null;
  if (typeof model.audio_credential_id === "string") {
    const voice = await tx.credential.findFirst({
      where: {
        id: model.audio_credential_id,
        workspaceId: ctx.workspaceId,
        status: "active",
        purpose: { in: ["chat", "all"] },
      },
      select: { provider: true },
    });
    voiceProvider = voice?.provider ?? null;
    if (!voice) {
      errors["model.audio_credential_id"] =
        "A chave escolhida não está ativa no cofre.";
    } else if (!voiceOptions(voice.provider)) {
      errors["model.audio_credential_id"] =
        "Escolha uma chave OpenAI ou Gemini para a voz.";
    }
  }
  const options = voiceProvider ? voiceOptions(voiceProvider) : null;
  if (
    typeof model.audio_voice === "string" &&
    model.audio_voice &&
    options &&
    !options.voices.includes(model.audio_voice)
  ) {
    errors["model.audio_voice"] = "Escolha uma voz da lista.";
  }
  if (typeof model.embedding_credential_id === "string") {
    const embedding = await tx.credential.findFirst({
      where: {
        id: model.embedding_credential_id,
        workspaceId: ctx.workspaceId,
        status: "active",
        purpose: { in: ["embeddings", "all"] },
      },
      select: { id: true },
    });
    if (!embedding) {
      errors["model.embedding_credential_id"] =
        "A chave escolhida não está ativa no cofre.";
    }
  }
  if (Object.keys(errors).length > 0) throw new ConfigValidationError(errors);
}
