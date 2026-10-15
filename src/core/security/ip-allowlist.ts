import "server-only";

import { recordAudit } from "@/core/audit/record";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  isPartnerRole,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { parseAllowlist } from "./allowlist";
import type { AllowlistArea } from "./ip-gate";

/**
 * IP allow lists of /platform and of each partner's /admin (CF5a). The
 * managers of the area read and write them (RLS repeats the rule); a list
 * that leaves out the saver's own address is refused, so saving never locks
 * the saver out. An empty list removes the restriction.
 */

export type AllowlistActor =
  | Readonly<{
      area: "platform";
      userId: string;
      platformRole: string | null;
    }>
  | Readonly<{
      area: "admin";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>;

export type AllowlistView = Readonly<{
  area: AllowlistArea;
  entries: string[];
  updatedAt: Date | null;
  canEdit: boolean;
  /** The address of this request, as the gate reads it. */
  currentIp: string | null;
}>;

function partnerOf(actor: AllowlistActor): string | null {
  return actor.area === "admin" ? actor.partnerId : null;
}

export function canManageAllowlist(actor: AllowlistActor): boolean {
  if (actor.area === "platform") {
    return (
      actor.platformRole !== null &&
      hasPlatformRolePermission(
        actor.platformRole as PlatformAdminRoleKey,
        Permissions.PLATFORM_SETTINGS_MANAGE,
      )
    );
  }
  return (
    actor.partnerRole !== null &&
    isPartnerRole(actor.partnerRole) &&
    hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_SETTINGS_MANAGE,
    )
  );
}

function invalid(
  message: string,
  key: string,
  values?: Record<string, string>,
): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `security.errors.${key}`,
    ...(values ? { messageValues: values } : {}),
  });
}

async function readRow(
  tx: ContextTransaction,
  actor: AllowlistActor,
): Promise<{ entries: string[]; updatedAt: Date } | null> {
  const rows = await tx.$queryRaw<
    Array<{ entries: string[]; updated_at: Date }>
  >`
    select entries::text[] as entries, updated_at
    from public.ip_allowlists
    where area = ${actor.area}
      and partner_id is not distinct from ${partnerOf(actor)}::uuid
  `;
  const row = rows[0];
  return row ? { entries: row.entries, updatedAt: row.updated_at } : null;
}

/** The area's list for its managers; empty for everybody else. */
export async function allowlistView(
  tx: ContextTransaction,
  actor: AllowlistActor,
  currentIp: string | null,
): Promise<AllowlistView> {
  const canEdit = canManageAllowlist(actor);
  const row = canEdit ? await readRow(tx, actor) : null;
  return {
    area: actor.area,
    entries: row?.entries ?? [],
    updatedAt: row?.updatedAt ?? null,
    canEdit,
    currentIp,
  };
}

/**
 * Saves the area's list from the form text (one address or block per
 * line). Refuses invalid entries, more than 50, and a list that does not
 * include `currentIp`; an unreadable address refuses any list.
 */
export async function saveAllowlist(
  tx: ContextTransaction,
  actor: AllowlistActor,
  text: string,
  currentIp: string | null,
): Promise<AllowlistView> {
  if (!canManageAllowlist(actor)) throw new PermissionDeniedError();
  const parsed = parseAllowlist(text);
  if (!parsed.ok) {
    throw parsed.reason === "too_many"
      ? invalid("A lista aceita até 50 endereços.", "tooMany")
      : invalid("Endereço inválido na lista.", "invalidEntries", {
          entries: parsed.invalid.join(", "),
        });
  }

  const current = await readRow(tx, actor);
  let status: "on" | "off" | null = null;
  let count = 0;

  if (parsed.entries.length === 0) {
    if (current) {
      await tx.$executeRaw`
        delete from public.ip_allowlists
        where area = ${actor.area}
          and partner_id is not distinct from ${partnerOf(actor)}::uuid
      `;
      status = "off";
    }
  } else {
    if (!currentIp) {
      throw invalid(
        "Não foi possível ler o seu endereço de rede; a lista não foi salva.",
        "ipUnknown",
      );
    }
    // The database normalizes the blocks (host bits dropped) and says
    // whether the saver's address is inside one of them.
    const [check] = await tx.$queryRaw<
      Array<{ entries: string[]; includes: boolean }>
    >`
      with list as (
        select array(
          select distinct network(entry::inet)::cidr
          from unnest(${parsed.entries}::text[]) as entry
          order by 1
        ) as entries
      )
      select entries::text[] as entries,
             ${currentIp}::inet <<= any (entries) as includes
      from list
    `;
    if (!check?.includes) {
      throw invalid(
        `A lista precisa incluir o seu endereço atual (${currentIp}).`,
        "selfExcluded",
        { ip: currentIp },
      );
    }
    count = check.entries.length;
    const same =
      current !== null &&
      JSON.stringify(current.entries) === JSON.stringify(check.entries);
    if (!same) {
      if (current) {
        await tx.$executeRaw`
          update public.ip_allowlists
          set entries = ${check.entries}::cidr[], updated_by = ${actor.userId}::uuid
          where area = ${actor.area}
            and partner_id is not distinct from ${partnerOf(actor)}::uuid
        `;
      } else {
        await tx.$executeRaw`
          insert into public.ip_allowlists (area, partner_id, entries, updated_by)
          values (${actor.area}, ${partnerOf(actor)}::uuid,
                  ${check.entries}::cidr[], ${actor.userId}::uuid)
        `;
      }
      status = "on";
    }
  }

  if (status) {
    const level = actor.area === "platform" ? "platform" : "partner";
    await recordAudit(
      tx,
      { userId: actor.userId, workspaceId: "", organizationId: "" },
      {
        action: `${level}.security.ip_allowlist.save`,
        resourceType: "ip_allowlist",
        resourceId: partnerOf(actor),
        result: "success",
        origin: "admin",
        metadata: {
          status,
          count,
          ...(actor.area === "admin" ? { partnerId: actor.partnerId } : {}),
        },
      },
    );
  }
  return allowlistView(tx, actor, currentIp);
}
