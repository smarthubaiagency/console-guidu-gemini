import "server-only";

import { z } from "zod";

import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { readCascade } from "@/core/settings/read";
import { resolveSettings } from "@/core/settings/resolve";
import { saveSettings } from "@/core/settings/service";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  AI_PROVIDERS,
  type AiPolicy,
  type AiProviderId,
  type BaseUrls,
  BaseUrlSchema,
  type ModelCatalog,
  ModelCatalogSchema,
  ProvidersSchema,
} from "./models";

/**
 * IA › Provedores e modelos (CF6a): the platform turns providers on, keeps
 * the catalog of models (the first one of each list is the default) and
 * may set an OpenAI-compatible gateway per provider; the partner narrows
 * providers and models for its customers. Values live in the settings
 * cascade (`ai.providers`, `ai.models`, `ai.base_urls`); writes go through
 * `saveSettings`, so the settings RLS and audit apply.
 */

export type AiProvidersActor =
  | Readonly<{ level: "platform"; userId: string; platformRole: string | null }>
  | Readonly<{
      level: "partner";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>;

export type AiProvidersView = Readonly<{
  level: "platform" | "partner";
  /** What the level above allows (the platform: everything it may offer). */
  inherited: AiPolicy;
  /** What applies now to the level's customers. */
  effective: AiPolicy;
  /** The platform's gateways (platform only; empty for the partner). */
  baseUrls: BaseUrls;
  canEdit: boolean;
}>;

function grants(actor: AiProvidersActor, manage: boolean): boolean {
  if (actor.level === "platform") {
    return (
      actor.platformRole !== null &&
      hasPlatformRolePermission(
        actor.platformRole as PlatformAdminRoleKey,
        Permissions.PLATFORM_AI_MANAGE,
      )
    );
  }
  return (
    actor.partnerRole !== null &&
    isPartnerRole(actor.partnerRole) &&
    hasPartnerRolePermission(
      actor.partnerRole,
      manage
        ? Permissions.PARTNER_AI_AGENTS_MANAGE
        : Permissions.PARTNER_AI_AGENTS_READ,
    )
  );
}

function policyOf(values: Record<string, unknown>): AiPolicy {
  return {
    providers: values["ai.providers"] as AiProviderId[],
    models: values["ai.models"] as ModelCatalog,
  };
}

export async function aiProvidersView(
  tx: ContextTransaction,
  actor: AiProvidersActor,
): Promise<AiProvidersView> {
  if (!grants(actor, false)) throw new PermissionDeniedError();
  const rows = await readCascade(tx);
  const effective = resolveSettings(rows).values;
  const inherited =
    actor.level === "platform"
      ? { providers: [...AI_PROVIDERS], models: effective["ai.models"] }
      : policyOf(resolveSettings(rows, { above: "partner" }).values);
  return {
    level: actor.level,
    inherited,
    effective: policyOf(effective),
    baseUrls: actor.level === "platform" ? effective["ai.base_urls"] : {},
    canEdit: grants(actor, true),
  };
}

const Input = z.strictObject({
  providers: ProvidersSchema,
  models: ModelCatalogSchema,
  baseUrls: z.partialRecord(z.enum(AI_PROVIDERS), z.string().trim()).optional(),
});

function invalid(message: string, key: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `aiConsole.providersPage.errors.${key}`,
  });
}

/**
 * Saves the level's providers and models. The partner may only choose
 * among what the platform allows; what equals the level above is stored
 * as "inherit", so a later change of the platform reaches the customers.
 */
export async function saveAiProviders(
  tx: ContextTransaction,
  actor: AiProvidersActor,
  input: unknown,
): Promise<AiProvidersView> {
  if (!grants(actor, true)) throw new PermissionDeniedError();
  const parsed = Input.safeParse(input);
  if (!parsed.success) throw invalid("Dados inválidos.", "invalid");
  const { providers, models } = parsed.data;
  const view = await aiProvidersView(tx, actor);

  const values: Record<string, unknown> = {};
  if (actor.level === "platform") {
    if (providers.length === 0) {
      throw invalid("Ligue pelo menos um provedor.", "noProvider");
    }
    values["ai.providers"] =
      providers.length === AI_PROVIDERS.length &&
      AI_PROVIDERS.every((p) => providers.includes(p))
        ? null
        : providers;
    values["ai.models"] = models;
    const baseUrls: BaseUrls = {};
    for (const [provider, raw] of Object.entries(parsed.data.baseUrls ?? {})) {
      if (!raw) continue;
      const url = BaseUrlSchema.safeParse(raw);
      if (!url.success) {
        throw invalid(
          "Use um endereço https:// sem usuário nem parâmetros.",
          "baseUrl",
        );
      }
      baseUrls[provider as AiProviderId] = url.data.replace(/\/+$/, "");
    }
    values["ai.base_urls"] = Object.keys(baseUrls).length > 0 ? baseUrls : null;
  } else {
    const above = view.inherited;
    if (providers.some((p) => !above.providers.includes(p))) {
      throw invalid("Provedor não liberado pela plataforma.", "notOffered");
    }
    if (providers.length === 0) {
      throw invalid(
        "Deixe pelo menos um provedor para os clientes.",
        "noProvider",
      );
    }
    const narrowed: ModelCatalog = {};
    for (const provider of AI_PROVIDERS) {
      const mine = models[provider];
      if (mine === undefined) continue;
      const top = above.models[provider];
      if (top && top.length > 0 && mine.some((m) => !top.includes(m))) {
        throw invalid("Modelo não liberado pela plataforma.", "notOffered");
      }
      if (top && top.length > 0 && mine.length === 0) {
        throw invalid(
          "Deixe pelo menos um modelo em cada provedor.",
          "noModel",
        );
      }
      const same =
        top !== undefined &&
        top.length === mine.length &&
        top.every((model, index) => mine[index] === model);
      if (!same) narrowed[provider] = mine;
    }
    values["ai.providers"] =
      providers.length === above.providers.length ? null : providers;
    values["ai.models"] = Object.keys(narrowed).length > 0 ? narrowed : null;
  }

  await saveSettings(
    tx,
    actor.level === "platform"
      ? {
          level: "platform",
          userId: actor.userId,
          platformRole: actor.platformRole,
        }
      : {
          level: "partner",
          userId: actor.userId,
          partnerId: actor.partnerId,
          partnerRole: actor.partnerRole,
        },
    { values },
  );
  return aiProvidersView(tx, actor);
}
