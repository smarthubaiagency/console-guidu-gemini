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

import { modelChoiceFieldErrors } from "./catalog";
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
 * The GUIDU Assistant of a partner (A3b, especificação §4): one per
 * partner, born from the house's admin template. In `/admin` the partner
 * changes its name, instructions and model connection (editor
 * `assistant`), and turns it on or off; the tools stay as the template
 * defines them. The key is one of the partner's vault; the provider comes
 * from it. Reading needs `partner.ai_agents.read`, changing
 * `partner.ai_agents.manage`; RLS repeats both. Runs in withIdentityContext
 * with the partner's id.
 */

export type AssistantActor = Readonly<{
  userId: string;
  partnerId: string;
  partnerRole: PartnerRoleKey | null;
}>;

export type AssistantDto = Readonly<{
  id: string;
  status: "draft" | "active" | "paused";
  config: AgentConfig;
  configValid: boolean;
  /** Minimum fields still empty (campos.md §9). */
  missing: readonly string[];
  templateVersion: number | null;
  updatedAt: string;
}>;

export const AssistantUpdateInput = z.strictObject({
  status: z.enum(["active", "paused"]),
  config: z.unknown(),
});

function requireRole(
  actor: AssistantActor,
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
    safeMessage: "Assistente não encontrado.",
    messageKey: "apiErrors.notFound",
  });
}

type Row = {
  id: string;
  status: string;
  config: unknown;
  configVersion: number;
  templateVersion: number | null;
  updatedAt: Date;
};

function toDto(row: Row): AssistantDto {
  const parsed = parseAgentConfig("assistant", row.configVersion, row.config);
  const config = parsed.success ? parsed.data : AgentConfigV1.parse({});
  return {
    id: row.id,
    status: row.status as AssistantDto["status"],
    config,
    configValid: parsed.success,
    missing: missingConfigFields(config, "assistant"),
    templateVersion: row.templateVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function load(tx: ContextTransaction, actor: AssistantActor) {
  const row = await tx.aiAgent.findFirst({
    where: { kind: "assistant", partnerId: actor.partnerId },
    select: {
      id: true,
      status: true,
      config: true,
      configVersion: true,
      templateVersion: true,
      updatedAt: true,
    },
  });
  if (!row) throw notFound();
  return row;
}

export async function getPartnerAssistant(
  tx: ContextTransaction,
  actor: AssistantActor,
): Promise<AssistantDto> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_READ);
  return toDto(await load(tx, actor));
}

/**
 * Saves the Assistant's configuration and status. Turning it on needs the
 * minimum fields; turning it off is always allowed. The provider follows the
 * chosen key of the partner's vault.
 */
export async function updatePartnerAssistant(
  tx: ContextTransaction,
  actor: AssistantActor,
  input: unknown,
): Promise<AssistantDto> {
  requireRole(actor, Permissions.PARTNER_AI_AGENTS_MANAGE);
  const parsed = AssistantUpdateInput.safeParse(input);
  if (!parsed.success) {
    throw new ConfigValidationError(configFieldErrors(parsed.error));
  }
  const row = await load(tx, actor);
  const current = toDto(row).config;
  const edit = applyConfigEdit(current, parsed.data.config, "assistant");
  if (edit.forbidden.length > 0) {
    throw new ConfigValidationError(
      Object.fromEntries(
        edit.forbidden.map((path) => [path, "Este campo não é do Assistente."]),
      ),
    );
  }

  // The provider of the chosen key; none without a key.
  const model = edit.config.model;
  delete model.model_provider;
  if (typeof model.credential_id === "string") {
    const credential = await tx.partnerCredential.findFirst({
      where: {
        id: model.credential_id,
        partnerId: actor.partnerId,
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
  // Providers and models of the cascade (CF6a): only a change is checked.
  const choice = await modelChoiceFieldErrors(
    tx,
    {
      provider: current.model.model_provider,
      model: current.model.model_name,
    },
    {
      provider: model.model_provider as string | undefined,
      model: model.model_name as string | undefined,
    },
  );
  if (Object.keys(choice).length > 0) throw new ConfigValidationError(choice);

  const config = parseAgentConfig(
    "assistant",
    CURRENT_CONFIG_VERSION,
    edit.config,
  );
  if (!config.success) {
    throw new ConfigValidationError(configFieldErrors(config.error));
  }
  // Off keeps a draft a draft; on needs the minimum fields.
  const status =
    parsed.data.status === "paused" && row.status === "draft"
      ? "draft"
      : parsed.data.status;
  if (status === "active") {
    const missing = missingConfigFields(config.data, "assistant");
    if (missing.length > 0) {
      throw new ConfigValidationError(
        Object.fromEntries(
          missing.map((path) => [path, "Preencha para ativar o Assistente."]),
        ),
      );
    }
  }

  const fields = [
    ...(status !== row.status ? ["status"] : []),
    ...edit.changed,
  ];
  if (fields.length === 0) return toDto(row);

  const saved = await tx.aiAgent.update({
    where: { id: row.id },
    data: {
      config: config.data,
      configVersion: CURRENT_CONFIG_VERSION,
      status,
      updatedBy: actor.userId,
      updatedByPartnerId: actor.partnerId,
    },
    select: {
      id: true,
      status: true,
      config: true,
      configVersion: true,
      templateVersion: true,
      updatedAt: true,
    },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "ai.assistant.update",
    resourceType: "ai_agent",
    resourceId: row.id,
    result: "success",
    origin: "admin",
    metadata: {
      partnerId: actor.partnerId,
      agentId: row.id,
      fields,
      from: { status: row.status },
      to: { status: saved.status },
      model: config.data.model.model_name ?? "",
    },
  });
  return toDto(saved);
}
