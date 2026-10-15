import "server-only";

import { Prisma } from "@prisma/client";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  PermissionDeniedError,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { WorkspaceRole } from "@/core/permissions/roles";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  isSettingKey,
  isTightenOnly,
  keysOfLevel,
  type SettingKey,
  type SettingLevel,
  SETTINGS,
} from "./catalog";
import { readCascade } from "./read";
import { type ResolvedSettings, resolveSettings } from "./resolve";

export { effectiveSettings, readCascade } from "./read";

/**
 * Pages and writes of the settings cascade (CF1). Reads go through
 * `./read`; writes go through the table, one level at a time, by the
 * level's managers: RLS repeats every check made here.
 */

/** Who writes, and at which level. */
export type SettingsActor =
  | Readonly<{
      level: "platform";
      userId: string;
      platformRole: string | null;
    }>
  | Readonly<{
      level: "partner";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>
  | Readonly<{
      level: "workspace";
      userId: string;
      ctx: RequestContext;
    }>;

export type OwnSetting = Readonly<{ value: unknown; locked: boolean }>;

export type SettingsView = Readonly<{
  level: SettingLevel;
  /** What the level gets with no value of its own. */
  inherited: ResolvedSettings;
  /** What applies now, the level's own values included. */
  effective: ResolvedSettings;
  own: Partial<Record<SettingKey, OwnSetting>>;
  keys: SettingKey[];
  canEdit: boolean;
}>;

function invalid(message: string, key: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `settings.errors.${key}`,
  });
}

async function canManage(
  tx: ContextTransaction,
  actor: SettingsActor,
): Promise<boolean> {
  switch (actor.level) {
    case "platform":
      return (
        actor.platformRole !== null &&
        hasPlatformRolePermission(
          actor.platformRole as PlatformAdminRoleKey,
          Permissions.PLATFORM_SETTINGS_MANAGE,
        )
      );
    case "partner":
      return (
        actor.partnerRole !== null &&
        isPartnerRole(actor.partnerRole) &&
        hasPartnerRolePermission(
          actor.partnerRole,
          Permissions.PARTNER_SETTINGS_MANAGE,
        )
      );
    case "workspace": {
      const role = await getEffectiveWorkspaceRole(tx, actor.ctx);
      return role
        ? workspaceRoleGrants(
            role as WorkspaceRole,
            "workspace.settings.update",
          )
        : false;
    }
  }
}

/** The level's page: inherited, effective and own values. */
export async function settingsView(
  tx: ContextTransaction,
  actor: SettingsActor,
): Promise<SettingsView> {
  const rows = await readCascade(tx);
  const own: Partial<Record<SettingKey, OwnSetting>> = {};
  for (const row of rows) {
    if (row.scope === actor.level && isSettingKey(row.key)) {
      own[row.key] = { value: row.value, locked: row.locked };
    }
  }
  return {
    level: actor.level,
    inherited: resolveSettings(rows, { above: actor.level }),
    effective: resolveSettings(rows),
    own,
    keys: keysOfLevel(actor.level),
    canEdit: await canManage(tx, actor),
  };
}

/** A value of the form: null (or absent) inherits from the level above. */
export type SettingsInput = Readonly<{
  values: Partial<Record<string, unknown>>;
  locks?: Partial<Record<string, boolean>>;
}>;

function scopeOf(actor: SettingsActor) {
  switch (actor.level) {
    case "platform":
      return {
        where: { scope: "platform" },
        data: { scope: "platform" },
      };
    case "partner":
      return {
        where: { scope: "partner", partnerId: actor.partnerId },
        data: { scope: "partner", partnerId: actor.partnerId },
      };
    case "workspace":
      return {
        where: { scope: "workspace", workspaceId: actor.ctx.workspaceId },
        data: {
          scope: "workspace",
          workspaceId: actor.ctx.workspaceId,
          organizationId: actor.ctx.organizationId,
        },
      };
  }
}

/**
 * Saves the level's values. A key outside the level, locked above it or
 * failing the catalog schema is refused; the currency must be one the
 * platform offers. Only the platform and the partner may lock.
 */
export async function saveSettings(
  tx: ContextTransaction,
  actor: SettingsActor,
  input: SettingsInput,
): Promise<SettingsView> {
  if (!(await canManage(tx, actor))) throw new PermissionDeniedError();
  const rows = await readCascade(tx);
  const inherited = resolveSettings(rows, { above: actor.level });
  const allowed = keysOfLevel(actor.level);
  const scope = scopeOf(actor);
  const changed: string[] = [];

  for (const [key, raw] of Object.entries(input.values)) {
    if (!isSettingKey(key) || !allowed.includes(key)) {
      throw invalid("Configuração desconhecida neste nível.", "unknown");
    }
    const lockedBy = inherited.detail[key].lockedBy;
    const current = rows.find(
      (row) => row.scope === actor.level && row.key === key,
    );
    const locked =
      actor.level !== "workspace" &&
      !isTightenOnly(key) &&
      (input.locks?.[key] ?? false);
    if (lockedBy) {
      if (raw === undefined || raw === null) continue;
      throw invalid(
        "Esta configuração foi travada pelo nível acima.",
        "locked",
      );
    }
    if (raw === undefined || raw === null || raw === "") {
      if (current) {
        await tx.setting.deleteMany({ where: { ...scope.where, key } });
        changed.push(key);
      }
      continue;
    }
    const parsed = SETTINGS[key].schema.safeParse(raw);
    if (!parsed.success)
      throw invalid("Valor inválido para a configuração.", "invalid");
    if (
      key === "region.currency" &&
      !(inherited.values["region.currencies"] as string[]).includes(
        parsed.data as string,
      ) &&
      actor.level !== "platform"
    ) {
      throw invalid("Moeda não oferecida pela plataforma.", "currency");
    }
    const value = parsed.data as Prisma.InputJsonValue;
    if (current) {
      if (
        JSON.stringify(current.value) === JSON.stringify(value) &&
        current.locked === locked
      ) {
        continue;
      }
      await tx.setting.updateMany({
        where: { ...scope.where, key },
        data: { value, locked, updatedBy: actor.userId },
      });
    } else {
      await tx.setting.create({
        data: { ...scope.data, key, value, locked, updatedBy: actor.userId },
      });
    }
    changed.push(key);
  }

  if (changed.length > 0) {
    await recordAudit(
      tx,
      actor.level === "workspace" ? actor.ctx : adminAuditContext(actor.userId),
      {
        action: `${actor.level}.settings.save`,
        resourceType: "settings",
        resourceId:
          actor.level === "partner"
            ? actor.partnerId
            : actor.level === "workspace"
              ? actor.ctx.workspaceId
              : null,
        result: "success",
        origin: actor.level === "workspace" ? "app" : "admin",
        metadata: {
          fields: changed,
          ...(actor.level === "partner" ? { partnerId: actor.partnerId } : {}),
        },
      },
    );
  }
  return settingsView(tx, actor);
}
