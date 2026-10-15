import "server-only";

import { recordAudit } from "@/core/audit/record";
import { type Permission, Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPlatformRolePermission,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  evaluateMaintenance,
  isMaintenanceMode,
  MAINTENANCE_LOCALES,
  type MaintenanceLocale,
  type MaintenanceMessages,
  type MaintenanceMode,
  type MaintenanceStatus,
  MAX_MESSAGE_LENGTH,
} from "./state";

/**
 * Operações › Manutenção (CF5c): the platform window, read by Operações'
 * readers (owner, operations, support) and changed by owner and operations
 * (`platform.settings.manage`); RLS repeats the rule. Every change is
 * audited (`platform.maintenance.save`, `platform.maintenance.end`), with
 * the mode and schedule but not the messages.
 */

export type MaintenanceActor = Readonly<{
  userId: string;
  platformRole: string | null;
}>;

export type MaintenanceRecord = Readonly<{
  enabled: boolean;
  mode: MaintenanceMode;
  startsAt: Date | null;
  endsAt: Date | null;
  messages: MaintenanceMessages;
  updatedAt: Date;
}>;

export type MaintenanceView = Readonly<{
  canEdit: boolean;
  record: MaintenanceRecord | null;
  /** What the saved window means now. */
  status: MaintenanceStatus;
}>;

export type MaintenanceInput = Readonly<{
  enabled: boolean;
  mode: string;
  startsAt: Date | null;
  endsAt: Date | null;
  messages: Readonly<Partial<Record<MaintenanceLocale, string | null>>>;
}>;

function roleHas(actor: MaintenanceActor, permission: Permission): boolean {
  return (
    actor.platformRole !== null &&
    hasPlatformRolePermission(
      actor.platformRole as PlatformAdminRoleKey,
      permission,
    )
  );
}

export function canReadMaintenance(actor: MaintenanceActor): boolean {
  return roleHas(actor, Permissions.PLATFORM_OPERATIONS_READ);
}

export function canManageMaintenance(actor: MaintenanceActor): boolean {
  return roleHas(actor, Permissions.PLATFORM_SETTINGS_MANAGE);
}

function invalid(message: string, key: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `maintenance.errors.${key}`,
  });
}

type Row = {
  enabled: boolean;
  mode: string;
  startsAt: Date | null;
  endsAt: Date | null;
  messagePtBr: string | null;
  messageEn: string | null;
  messageEs: string | null;
  updatedAt: Date;
};

function toRecord(row: Row): MaintenanceRecord {
  return {
    enabled: row.enabled,
    mode: isMaintenanceMode(row.mode) ? row.mode : "maintenance",
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    messages: {
      ...(row.messagePtBr ? { "pt-BR": row.messagePtBr } : {}),
      ...(row.messageEn ? { en: row.messageEn } : {}),
      ...(row.messageEs ? { es: row.messageEs } : {}),
    },
    updatedAt: row.updatedAt,
  };
}

async function readRecord(
  tx: ContextTransaction,
): Promise<MaintenanceRecord | null> {
  const row = await tx.platformMaintenance.findUnique({ where: { id: true } });
  return row ? toRecord(row) : null;
}

function statusOf(record: MaintenanceRecord | null, now: Date) {
  return evaluateMaintenance(
    record?.enabled
      ? {
          mode: record.mode,
          startsAt: record.startsAt,
          endsAt: record.endsAt,
          messages: record.messages,
        }
      : null,
    now,
  );
}

/** The window for Operações' readers; null record for everybody else. */
export async function maintenanceView(
  tx: ContextTransaction,
  actor: MaintenanceActor,
  now: Date = new Date(),
): Promise<MaintenanceView> {
  const record = canReadMaintenance(actor) ? await readRecord(tx) : null;
  return {
    canEdit: canManageMaintenance(actor),
    record,
    status: statusOf(record, now),
  };
}

const COLUMN: Record<
  MaintenanceLocale,
  "messagePtBr" | "messageEn" | "messageEs"
> = {
  "pt-BR": "messagePtBr",
  en: "messageEn",
  es: "messageEs",
};

function cleanMessages(
  input: MaintenanceInput["messages"],
): Record<"messagePtBr" | "messageEn" | "messageEs", string | null> {
  const out = { messagePtBr: null, messageEn: null, messageEs: null } as Record<
    "messagePtBr" | "messageEn" | "messageEs",
    string | null
  >;
  for (const locale of MAINTENANCE_LOCALES) {
    const text = input[locale]?.trim() ?? "";
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw invalid(
        "Cada mensagem aceita até 500 caracteres.",
        "messageTooLong",
      );
    }
    out[COLUMN[locale]] = text === "" ? null : text;
  }
  return out;
}

/**
 * Saves the window. Turned on, an empty start means "now" (the moment is
 * stored), the end must come after the start and be in the future, and an
 * empty end lasts until someone turns it off. Turned off, the fields are
 * kept for the next time.
 */
export async function saveMaintenance(
  tx: ContextTransaction,
  actor: MaintenanceActor,
  input: MaintenanceInput,
  now: Date = new Date(),
): Promise<MaintenanceView> {
  if (!canManageMaintenance(actor)) throw new PermissionDeniedError();
  if (!isMaintenanceMode(input.mode)) {
    throw invalid("Modo de manutenção inválido.", "invalidMode");
  }
  const messages = cleanMessages(input.messages);
  const startsAt = input.enabled ? (input.startsAt ?? now) : input.startsAt;
  const endsAt = input.endsAt;
  if (endsAt && startsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw invalid("O fim precisa ser depois do início.", "endBeforeStart");
  }
  if (input.enabled && endsAt && endsAt.getTime() <= now.getTime()) {
    throw invalid("O fim precisa estar no futuro.", "endInPast");
  }

  const current = await readRecord(tx);
  const next = {
    enabled: input.enabled,
    mode: input.mode,
    startsAt,
    endsAt,
    ...messages,
  };
  const fields: string[] = [];
  if (current?.enabled !== next.enabled) fields.push("enabled");
  if (current?.mode !== next.mode) fields.push("mode");
  if (current?.startsAt?.getTime() !== next.startsAt?.getTime()) {
    fields.push("startsAt");
  }
  if (current?.endsAt?.getTime() !== next.endsAt?.getTime()) {
    fields.push("endsAt");
  }
  for (const locale of MAINTENANCE_LOCALES) {
    if ((current?.messages[locale] ?? null) !== next[COLUMN[locale]]) {
      fields.push(`message.${locale}`);
    }
  }
  if (current && fields.length === 0) return maintenanceView(tx, actor, now);

  const data = { ...next, updatedBy: actor.userId };
  if (current) {
    await tx.platformMaintenance.update({ where: { id: true }, data });
  } else {
    await tx.platformMaintenance.create({ data: { id: true, ...data } });
  }
  await recordAudit(
    tx,
    { userId: actor.userId, workspaceId: "", organizationId: "" },
    {
      action: "platform.maintenance.save",
      resourceType: "platform_maintenance",
      result: "success",
      origin: "admin",
      metadata: {
        status: next.enabled ? "on" : "off",
        mode: next.mode,
        fields,
        ...(next.startsAt ? { startsAt: next.startsAt.toISOString() } : {}),
        ...(next.endsAt ? { endsAt: next.endsAt.toISOString() } : {}),
      },
    },
  );
  return maintenanceView(tx, actor, now);
}

/** Turns the window off now, keeping its fields; audited when it was on. */
export async function endMaintenance(
  tx: ContextTransaction,
  actor: MaintenanceActor,
  now: Date = new Date(),
): Promise<MaintenanceView> {
  if (!canManageMaintenance(actor)) throw new PermissionDeniedError();
  const current = await readRecord(tx);
  if (current?.enabled) {
    await tx.platformMaintenance.update({
      where: { id: true },
      data: { enabled: false, updatedBy: actor.userId },
    });
    await recordAudit(
      tx,
      { userId: actor.userId, workspaceId: "", organizationId: "" },
      {
        action: "platform.maintenance.end",
        resourceType: "platform_maintenance",
        result: "success",
        origin: "admin",
        metadata: { status: "off", mode: current.mode },
      },
    );
  }
  return maintenanceView(tx, actor, now);
}
