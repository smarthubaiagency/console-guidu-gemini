import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import {
  adminAuditContext,
  requirePlatformPermission,
} from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { modelChoiceFieldErrors } from "./catalog";
import {
  applyConfigEdit,
  configFieldErrors,
  sameValue,
} from "./config/editing";
import {
  type AgentConfig,
  AgentConfigV1,
  agentKindOfTemplate,
  CURRENT_CONFIG_VERSION,
  parseAgentConfig,
} from "./config/schema";

/**
 * Agent templates (A3a, especificação §5.1): the house's, managed in
 * `/platform` (`platform.ai.manage`), and the partner's, in `/admin`
 * (`partner.ai_agents.manage`, A3b). The owner edits every field of the
 * configuration but the key (config/editing.ts). The template's prompt is
 * `overview.system_prompt`, also kept in `prompt_template`, so an agent
 * created from it starts with the prompt. A change of content (prompt or
 * configuration) raises the version; GUIDS already created keep theirs.
 * The admin template (the Assistant's) is never deleted nor unpublished.
 * RLS repeats owner and role; the platform runs in withPlatformContext, a
 * partner in withIdentityContext with its id.
 */

export type TemplateActor = Readonly<{
  userId: string;
  /** Null for the house's templates, the partner's id for its own. */
  partnerId: string | null;
  platformRole?: PlatformAdminRoleKey | null;
  partnerRole?: PartnerRoleKey | null;
}>;

export type TemplateSummaryDto = Readonly<{
  id: string;
  kind: "guid" | "admin";
  name: string;
  description: string | null;
  segment: string | null;
  version: number;
  published: boolean;
  updatedAt: string;
}>;

export type TemplateDetailDto = TemplateSummaryDto &
  Readonly<{
    /** The stored configuration; `{}` while it does not validate. */
    config: AgentConfig;
    configValid: boolean;
  }>;

/** Error of an invalid configuration, with the message of each field. */
export class ConfigValidationError extends AppError {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super({
      code: "invalid_input",
      safeMessage: "Revise os campos destacados.",
      messageKey: "aiConsole.errors.invalidConfig",
    });
    this.fieldErrors = fieldErrors;
  }
}

const Meta = {
  name: z
    .string()
    .trim()
    .min(1, { error: "Informe o nome do modelo." })
    .max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null),
  segment: z
    .string()
    .trim()
    .max(80)
    .transform((v) => v || null),
};

export const TemplateCreateInput = z.strictObject({
  name: Meta.name,
  description: Meta.description.default(""),
  segment: Meta.segment.default(""),
});

export const TemplateUpdateInput = z.strictObject({
  name: Meta.name,
  description: Meta.description,
  segment: Meta.segment,
  published: z.boolean(),
  config: z.unknown(),
});

function requireManager(actor: TemplateActor): void {
  if (actor.partnerId === null) {
    requirePlatformPermission(
      actor.platformRole ?? null,
      Permissions.PLATFORM_AI_MANAGE,
    );
    return;
  }
  if (
    !actor.partnerRole ||
    !hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_AI_AGENTS_MANAGE,
    )
  ) {
    throw new PermissionDeniedError();
  }
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Modelo de agente não encontrado.",
    messageKey: "apiErrors.notFound",
  });
}

function invalidMeta(error: z.ZodError): ConfigValidationError {
  return new ConfigValidationError(configFieldErrors(error));
}

type Row = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  segment: string | null;
  version: number;
  published: boolean;
  updatedAt: Date;
};

function toSummary(row: Row): TemplateSummaryDto {
  return {
    id: row.id,
    kind: row.kind as "guid" | "admin",
    name: row.name,
    description: row.description,
    segment: row.segment,
    version: row.version,
    published: row.published,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The stored configuration with the prompt of the template in it. */
function storedConfig(row: {
  kind: string;
  configVersion: number;
  defaults: unknown;
  promptTemplate: string;
}): { config: AgentConfig; valid: boolean } {
  const parsed = parseAgentConfig(
    agentKindOfTemplate(row.kind as "guid" | "admin"),
    row.configVersion,
    row.defaults,
  );
  const config = parsed.success ? parsed.data : AgentConfigV1.parse({});
  // Templates of the A1 keep the prompt only in `prompt_template`.
  if (!config.overview.system_prompt?.trim() && row.promptTemplate.trim()) {
    config.overview.system_prompt = row.promptTemplate;
  }
  return { config, valid: parsed.success };
}

/** The owner's filter: the house's templates or the partner's. */
function ownedBy(actor: TemplateActor) {
  return { partnerId: actor.partnerId };
}

export async function listTemplates(
  tx: ContextTransaction,
  actor: TemplateActor,
): Promise<TemplateSummaryDto[]> {
  requireManager(actor);
  const rows = await tx.aiAgentTemplate.findMany({
    where: ownedBy(actor),
    // The admin template first, then by name.
    orderBy: [{ kind: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getTemplate(
  tx: ContextTransaction,
  actor: TemplateActor,
  templateId: string,
): Promise<TemplateDetailDto> {
  requireManager(actor);
  if (!z.uuid().safeParse(templateId).success) throw notFound();
  const row = await tx.aiAgentTemplate.findFirst({
    where: { id: templateId, ...ownedBy(actor) },
  });
  if (!row) throw notFound();
  const { config, valid } = storedConfig(row);
  return { ...toSummary(row), config, configValid: valid };
}

/** A new GUIDS template, blank and unpublished. */
export async function createTemplate(
  tx: ContextTransaction,
  actor: TemplateActor,
  input: unknown,
): Promise<TemplateSummaryDto> {
  requireManager(actor);
  const parsed = TemplateCreateInput.safeParse(input);
  if (!parsed.success) throw invalidMeta(parsed.error);
  const row = await tx.aiAgentTemplate.create({
    data: {
      partnerId: actor.partnerId,
      kind: "guid",
      name: parsed.data.name,
      description: parsed.data.description,
      segment: parsed.data.segment,
      defaults: {},
      configVersion: CURRENT_CONFIG_VERSION,
      createdBy: actor.userId,
    },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "ai.template.create",
    resourceType: "ai_agent_template",
    resourceId: row.id,
    result: "success",
    origin: "admin",
    metadata: {
      name: row.name,
      partnerId: actor.partnerId ?? "",
      version: row.version,
    },
  });
  return toSummary(row);
}

/**
 * Saves name, description, segment, publication and configuration. The
 * configuration is validated whole for the template's kind; the fields of
 * each invalid value come back in `ConfigValidationError`.
 */
export async function updateTemplate(
  tx: ContextTransaction,
  actor: TemplateActor,
  templateId: string,
  input: unknown,
): Promise<TemplateDetailDto> {
  requireManager(actor);
  const parsed = TemplateUpdateInput.safeParse(input);
  if (!parsed.success) throw invalidMeta(parsed.error);
  if (!z.uuid().safeParse(templateId).success) throw notFound();
  const row = await tx.aiAgentTemplate.findFirst({
    where: { id: templateId, ...ownedBy(actor) },
  });
  if (!row) throw notFound();
  const kind = row.kind as "guid" | "admin";

  const current = storedConfig(row).config;
  const edit = applyConfigEdit(current, parsed.data.config, "template");
  if (edit.forbidden.length > 0) {
    throw new ConfigValidationError(
      Object.fromEntries(
        edit.forbidden.map((path) => [path, "Este campo não é do modelo."]),
      ),
    );
  }
  const config = parseAgentConfig(
    agentKindOfTemplate(kind),
    CURRENT_CONFIG_VERSION,
    edit.config,
  );
  if (!config.success) {
    throw new ConfigValidationError(configFieldErrors(config.error));
  }
  // Providers and models of the cascade (CF6a): only a change is checked.
  const choice = await modelChoiceFieldErrors(
    tx,
    {
      provider: current.model.model_provider,
      model: current.model.model_name,
    },
    {
      provider: config.data.model.model_provider,
      model: config.data.model.model_name,
    },
    "model.model_provider",
  );
  if (Object.keys(choice).length > 0) throw new ConfigValidationError(choice);
  const prompt = config.data.overview.system_prompt ?? "";
  const contentChanged =
    edit.changed.length > 0 ||
    row.configVersion !== CURRENT_CONFIG_VERSION ||
    !sameValue(row.defaults, config.data);
  // The Assistant's template stays published.
  const published = kind === "admin" ? true : parsed.data.published;
  const publishing = published && !row.published;

  const fields = [
    ...(parsed.data.name !== row.name ? ["name"] : []),
    ...(parsed.data.description !== row.description ? ["description"] : []),
    ...(parsed.data.segment !== row.segment ? ["segment"] : []),
    ...(published !== row.published ? ["published"] : []),
    ...edit.changed,
  ];
  if (fields.length === 0 && !contentChanged) {
    const { config: same, valid } = storedConfig(row);
    return { ...toSummary(row), config: same, configValid: valid };
  }

  const saved = await tx.aiAgentTemplate.update({
    where: { id: row.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      segment: parsed.data.segment,
      published,
      ...(publishing
        ? { approvedBy: actor.userId, approvedAt: new Date() }
        : {}),
      ...(published ? {} : { approvedBy: null, approvedAt: null }),
      defaults: config.data,
      configVersion: CURRENT_CONFIG_VERSION,
      promptTemplate: prompt,
      ...(edit.changed.length > 0 ? { version: row.version + 1 } : {}),
      updatedBy: actor.userId,
    },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "ai.template.update",
    resourceType: "ai_agent_template",
    resourceId: row.id,
    result: "success",
    origin: "admin",
    metadata: {
      name: saved.name,
      partnerId: actor.partnerId ?? "",
      fields,
      from: { version: row.version, published: row.published },
      to: { version: saved.version, published: saved.published },
    },
  });
  return { ...toSummary(saved), config: config.data, configValid: true };
}

/** Deletes a GUIDS template; the agents created from it keep their copy. */
export async function deleteTemplate(
  tx: ContextTransaction,
  actor: TemplateActor,
  templateId: string,
): Promise<void> {
  requireManager(actor);
  if (!z.uuid().safeParse(templateId).success) throw notFound();
  const row = await tx.aiAgentTemplate.findFirst({
    where: { id: templateId, ...ownedBy(actor) },
    select: { id: true, kind: true, name: true, version: true },
  });
  if (!row) throw notFound();
  if (row.kind !== "guid") {
    throw new AppError({
      code: "conflict",
      safeMessage: "O modelo do Assistente não pode ser excluído.",
      messageKey: "aiConsole.errors.adminTemplateDelete",
    });
  }
  await tx.aiAgentTemplate.delete({ where: { id: row.id } });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "ai.template.delete",
    resourceType: "ai_agent_template",
    resourceId: row.id,
    result: "success",
    origin: "admin",
    metadata: {
      name: row.name,
      partnerId: actor.partnerId ?? "",
      version: row.version,
    },
  });
}

/** The list and the template named in the URL, for the screens. */
export async function loadTemplatesView(
  tx: ContextTransaction,
  actor: TemplateActor,
  editKey: string | null,
): Promise<{
  templates: TemplateSummaryDto[];
  opened: TemplateDetailDto | null;
}> {
  const templates = await listTemplates(tx, actor);
  let opened: TemplateDetailDto | null = null;
  if (editKey && editKey !== "new") {
    try {
      opened = await getTemplate(tx, actor, editKey);
    } catch (err) {
      if (!(err instanceof AppError && err.code === "not_found")) throw err;
    }
  }
  return { templates, opened };
}
