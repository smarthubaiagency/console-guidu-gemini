/**
 * ============================================================================
 * File: src/core/module-runtime/settings.ts
 * Module: Module enablement and configuration services (ADRs 0005 e 0006)
 *
 * Maintenance Rationale:
 * - Workspace and global configuration have separate storage and services;
 *   the scope is never inferred from a URL sent by the browser (Adendo §8.2).
 * - Every save is validated by the manifest `configurationSchema`, checks the
 *   declared write permissions on the server and is audited in the same
 *   transaction (Especificação §20).
 * - Configuration holds no secrets: secrets are vault references (§16).
 * ============================================================================
 */

import "server-only";

import { Prisma } from "@prisma/client";

import { recordAudit } from "@/core/audit/record";
import type { Permission, PermissionKey } from "@/core/permissions/catalog";
import { Permissions } from "@/core/permissions/catalog";
import {
  PermissionDeniedError,
  requireWorkspacePermission,
} from "@/core/permissions/guard";
import {
  hasPlatformRolePermission,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { AppError } from "@/shared/errors";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { getRegisteredModule, type RegisteredModule } from "@/modules/registry";

import {
  getModuleAccessState,
  type PlatformAvailability,
  type WorkspaceModuleStatus,
} from "./state";

function requireModule(moduleKey: string): RegisteredModule {
  const mod = getRegisteredModule(moduleKey);
  if (!mod || !mod.technicalGate()) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Módulo não encontrado.",
    });
  }
  return mod;
}

function invalidConfig(): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: "Configuração inválida para este módulo.",
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Parses stored configuration; invalid stored data falls back to empty. */
function parseStored(
  schema: RegisteredModule["manifest"]["configurationSchema"]["workspace"],
  raw: unknown,
) {
  if (!schema) return {};
  const parsed = schema.safeParse(asObject(raw));
  return parsed.success ? asObject(parsed.data) : {};
}

// ----------------------------------------------------------------------------
// Workspace scope
// ----------------------------------------------------------------------------

export async function setWorkspaceModuleStatus(
  tx: ContextTransaction,
  ctx: RequestContext,
  moduleKey: string,
  status: WorkspaceModuleStatus,
): Promise<void> {
  await requireWorkspacePermission(
    tx,
    ctx,
    Permissions.WORKSPACE_MODULES_MANAGE,
  );
  requireModule(moduleKey);

  const state = await getModuleAccessState(tx, ctx, moduleKey);
  if (state === "hidden" || state === "coming_soon") {
    throw new AppError({
      code: "conflict",
      safeMessage: "Este módulo ainda não pode ser habilitado.",
    });
  }

  const existing = await tx.workspaceModule.findFirst({
    where: { workspaceId: ctx.workspaceId, moduleKey },
  });
  const from = existing?.status ?? "disabled";
  if (from === status) return;

  if (existing) {
    await tx.workspaceModule.update({
      where: { id: existing.id },
      data: { status, updatedBy: ctx.userId },
    });
  } else {
    await tx.workspaceModule.create({
      data: {
        workspaceId: ctx.workspaceId,
        organizationId: ctx.organizationId,
        moduleKey,
        status,
        updatedBy: ctx.userId,
      },
    });
  }

  await recordAudit(tx, ctx, {
    action:
      status === "enabled"
        ? "workspace.module.enable"
        : "workspace.module.disable",
    resourceType: "workspace_module",
    resourceId: moduleKey,
    result: "success",
    metadata: { target: moduleKey, from, to: status },
  });
}

/** Stored workspace configuration of a module, validated by its schema. */
export async function getWorkspaceModuleConfig(
  tx: ContextTransaction,
  ctx: RequestContext,
  moduleKey: string,
): Promise<Record<string, unknown>> {
  const mod = requireModule(moduleKey);
  const row = await tx.workspaceModule.findFirst({
    where: { workspaceId: ctx.workspaceId, moduleKey },
  });
  return parseStored(mod.manifest.configurationSchema.workspace, row?.config);
}

export async function saveWorkspaceModuleConfig(
  tx: ContextTransaction,
  ctx: RequestContext,
  moduleKey: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const mod = requireModule(moduleKey);
  const entry = mod.manifest.settings.find(
    (s) => s.destination === "workspace",
  );
  const schema = mod.manifest.configurationSchema.workspace;
  if (!entry || !schema) throw invalidConfig();

  for (const permission of entry.writePermissions) {
    await requireWorkspacePermission(tx, ctx, permission as PermissionKey);
  }
  if ((await getModuleAccessState(tx, ctx, moduleKey)) !== "enabled") {
    throw new AppError({
      code: "conflict",
      safeMessage: "Habilite o módulo antes de configurá-lo.",
    });
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidConfig();
  const config = asObject(parsed.data);

  await tx.workspaceModule.update({
    where: {
      workspaceId_moduleKey: { workspaceId: ctx.workspaceId, moduleKey },
    },
    data: { config: config as Prisma.InputJsonObject, updatedBy: ctx.userId },
  });

  await recordAudit(tx, ctx, {
    action: "workspace.module.settings.update",
    resourceType: "workspace_module",
    resourceId: moduleKey,
    result: "success",
    metadata: { target: moduleKey },
  });

  return config;
}

// ----------------------------------------------------------------------------
// Global scope (platform admin)
// ----------------------------------------------------------------------------

export function requirePlatformPermission(
  role: PlatformAdminRoleKey | null,
  permission: Permission,
): void {
  if (!role || !hasPlatformRolePermission(role, permission)) {
    throw new PermissionDeniedError();
  }
}

/** Audit context for platform admin actions (no workspace). */
export function adminAuditContext(userId: string): RequestContext {
  return { userId, workspaceId: "", organizationId: "" };
}

export async function getPlatformModuleConfig(
  tx: ContextTransaction,
  moduleKey: string,
): Promise<Record<string, unknown>> {
  const mod = requireModule(moduleKey);
  const row = await tx.platformModule.findUnique({ where: { moduleKey } });
  return parseStored(mod.manifest.configurationSchema.admin, row?.config);
}

export async function getPlatformModuleAvailability(
  tx: ContextTransaction,
  moduleKey: string,
): Promise<PlatformAvailability> {
  const row = await tx.platformModule.findUnique({ where: { moduleKey } });
  return (row?.availability as PlatformAvailability | undefined) ?? "enabled";
}

export async function savePlatformModuleConfig(
  tx: ContextTransaction,
  userId: string,
  role: PlatformAdminRoleKey | null,
  moduleKey: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const mod = requireModule(moduleKey);
  const entry = mod.manifest.settings.find((s) => s.destination === "admin");
  const schema = mod.manifest.configurationSchema.admin;
  if (!entry || !schema) throw invalidConfig();
  for (const permission of entry.writePermissions) {
    requirePlatformPermission(role, permission as Permission);
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidConfig();
  const config = asObject(parsed.data) as Prisma.InputJsonObject;

  await tx.platformModule.upsert({
    where: { moduleKey },
    create: { moduleKey, config, updatedBy: userId },
    update: { config, updatedBy: userId },
  });

  await recordAudit(tx, adminAuditContext(userId), {
    action: "platform.module.settings.update",
    resourceType: "platform_module",
    resourceId: moduleKey,
    result: "success",
    origin: "admin",
    metadata: { target: moduleKey },
  });

  return asObject(parsed.data);
}

export async function setPlatformModuleAvailability(
  tx: ContextTransaction,
  userId: string,
  role: PlatformAdminRoleKey | null,
  moduleKey: string,
  availability: PlatformAvailability,
): Promise<void> {
  requirePlatformPermission(role, Permissions.PLATFORM_MODULES_MANAGE);
  requireModule(moduleKey);

  const from = await getPlatformModuleAvailability(tx, moduleKey);
  if (from === availability) return;

  await tx.platformModule.upsert({
    where: { moduleKey },
    create: { moduleKey, availability, updatedBy: userId },
    update: { availability, updatedBy: userId },
  });

  await recordAudit(tx, adminAuditContext(userId), {
    action: "platform.module.availability.update",
    resourceType: "platform_module",
    resourceId: moduleKey,
    result: "success",
    origin: "admin",
    metadata: { target: moduleKey, from, to: availability },
  });
}
