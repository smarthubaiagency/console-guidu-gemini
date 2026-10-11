import { z } from "zod";

import { type Permission, Permissions } from "@/core/permissions/catalog";
import {
  hasPlatformRolePermission,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";

/**
 * Scopes of the administrative keys (F4e, Especificação §17.3). Read only
 * in this phase; each scope needs a permission of the internal role, checked
 * when the key is created and again on every request.
 */
export const PLATFORM_SCOPES = [
  "admin:customers:read",
  "admin:operations:read",
] as const;

export const PlatformScopeSchema = z.enum(PLATFORM_SCOPES);
export type PlatformScope = z.infer<typeof PlatformScopeSchema>;

export const PLATFORM_SCOPE_PERMISSION: Readonly<
  Record<PlatformScope, Permission>
> = {
  "admin:customers:read": Permissions.PLATFORM_CUSTOMERS_READ,
  "admin:operations:read": Permissions.PLATFORM_OPERATIONS_READ,
};

export const PLATFORM_SCOPE_DEFINITIONS: readonly Readonly<{
  id: PlatformScope;
  label: string;
  desc: string;
}>[] = [
  {
    id: "admin:customers:read",
    label: "Clientes (admin:customers:read)",
    desc: "Empresas com dados comerciais mínimos: situação, workspaces e plano (plano só para quem lê cobrança).",
  },
  {
    id: "admin:operations:read",
    label: "Operações (admin:operations:read)",
    desc: "Saúde do worker e das filas e jobs com falha, sem conteúdo de cliente.",
  },
];

export function roleAllowsScope(
  role: PlatformAdminRoleKey | null,
  scope: PlatformScope,
): boolean {
  return Boolean(
    role && hasPlatformRolePermission(role, PLATFORM_SCOPE_PERMISSION[scope]),
  );
}
